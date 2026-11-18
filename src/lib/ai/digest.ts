import { z } from "zod";
import { getCards, type Card } from "../cards";
import type { DB } from "../db";
import { knowledgeText } from "../knowledge";
import { personThoughts } from "../library";
import { recentNotes } from "../notebook";
import { PAGE_LINES_MAX, getPage, savePage, settle, unsettled, type MindPage, type PageLine } from "../page";
import { listThoughts, type Thought } from "../thoughts";
import { askJson } from "./llm";
import { tooSimilar } from "./ponder";
import { majorityLanguage } from "./tidy";

// The bird takes new thoughts into the one page it keeps: what's on the person's mind right now.
// Once a thought is in the page, its bubble floats away. Nothing is deleted; it's just out of sight.

const KEEPER = `You are a small bird who listens to one person think out loud. You keep one short page for them: what is on their mind right now. They never reread their own thoughts, so this page is all they will look at. It must be short, plain and true.

You only write what their thoughts say. You never guess at feelings or motives they did not put into words, and you never give advice.`;

const TASK = `Rewrite the page so it takes in the new thoughts.

"lines": what is on their mind right now. ${PAGE_LINES_MAX} lines at most; fewer is better when there is less.
- One line per thing: a project, a choice, a worry, a person, a plan. Thoughts about the same thing become one line.
- Never two lines about the same person or the same worry under different names ("the boss" and "the job" with the same trouble are one line).
- "thing": their own name for it, 1 to 3 words ("keystrike", "the job", "hannah").
- "now": where it stands right now, as a full sentence to them, using "you": what you decided, what you want, what is still open. At most 18 words. It must tell them something, not just repeat the name.
- Lowercase. Plain everyday words. No metaphors.
- Newer thoughts and things they keep coming back to matter most. The most alive thing goes first.
- A line from the old page stays only while it is still true. Change it when a new thought changes it. Drop it when it is settled, or when newer things have pushed it out.

"step": the one small thing they could do next. It must come from something they said they want or need to do.
- Small enough to start today, and concrete: say what to do and to what. Starts with a verb. At most 14 words. Lowercase.
- Keep the old step if it still fits. Never one from steps_they_did or steps_they_did_not_want.
- An empty string when nothing they said gives one. That is fine.`;

export const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { thing: { type: "string" }, now: { type: "string" } },
        required: ["thing", "now"],
        additionalProperties: false,
      },
    },
    step: { type: "string" },
  },
  required: ["lines", "step"],
  additionalProperties: false,
} as const;

/** How many already-settled thoughts the bird keeps in view while rewriting. */
const EARLIER_SHOWN = 24;
/** New thoughts taken in at once. More than this wait for the next rewrite. */
const FRESH_MAX = 24;
const SHOWN = 260;
const DIGEST_TIMEOUT_MS = 150_000;

const flat = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};

export interface DigestInput {
  page: MindPage;
  /** Thoughts not in the page yet. */
  fresh: readonly Thought[];
  /** Thoughts already taken in, oldest first, for context. */
  earlier: readonly Thought[];
  cards: ReadonlyMap<number, Card>;
  knowledge: string;
  did: readonly string[];
  nope: readonly string[];
  today: string;
}

const list = (items: readonly string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join("\n") : empty);

export function buildDigestUser(input: DigestInput): string {
  const { cards } = input;
  // The bird's own summary of the whole thought, with what they said they want to do about it.
  const line = (t: Thought) => {
    const card = cards.get(t.id);
    const what = card ? card.gist : flat(t.body, SHOWN);
    const todos = card?.todos.length ? ` [they want to: ${card.todos.join("; ")}]` : "";
    return `${t.createdAt.slice(0, 10)}: ${what}${todos}`;
  };
  const parts = [
    input.knowledge,
    `<old_page>\n${list(
      input.page.lines.map((l) => `${l.thing}: ${l.now}`),
      "(empty: this is the first page)",
    )}\n</old_page>`,
    `<old_step>${input.page.step ?? "(none)"}</old_step>`,
  ];
  if (input.did.length) parts.push(`<steps_they_did>\n${list(input.did, "")}\n</steps_they_did>`);
  if (input.nope.length) parts.push(`<steps_they_did_not_want>\n${list(input.nope, "")}\n</steps_they_did_not_want>`);
  parts.push(`<earlier_thoughts note="already in the old page, oldest first">\n${list(input.earlier.map(line), "(none)")}\n</earlier_thoughts>`);
  parts.push(`<new_thoughts note="not in the page yet">\n${list(input.fresh.map(line), "(none)")}\n</new_thoughts>`);
  const lang = majorityLanguage([...input.earlier, ...input.fresh]);
  parts.push(`Today is ${input.today}.\n\n${TASK}\n\nWrite the page in ${lang ?? "the language most of the thoughts are written in"}.`);
  return parts.join("\n\n");
}

const Raw = z.object({
  lines: z.array(z.object({ thing: z.string().optional().default(""), now: z.string() })).default([]),
  step: z.string().optional().default(""),
});

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The model's page, cleaned up. Throws when there is nothing usable on it. */
export function parseDigest(value: unknown, avoid: readonly string[] = []): { lines: PageLine[]; step: string | null } {
  const raw = Raw.parse(value);
  const lines: PageLine[] = [];
  for (const l of raw.lines) {
    const thing = tidy(l.thing).replace(/[:.]+$/, "").toLowerCase();
    const now = tidy(l.now);
    // The same thing twice is one line.
    if (!now || lines.some((seen) => (thing && seen.thing === thing) || tooSimilar(seen.now, now))) continue;
    lines.push({ thing, now });
    if (lines.length >= PAGE_LINES_MAX) break;
  }
  if (lines.length === 0) throw new Error("the page came back empty");
  const step = raw.step.replace(/\s+/g, " ").trim();
  const refused = step && avoid.some((a) => tooSimilar(a, step));
  return { lines, step: step && !refused ? step : null };
}

/** Whether there are thoughts waiting to be taken into the page. */
export function needsDigest(db: DB): boolean {
  return unsettled(db).length > 0;
}

/**
 * Rewrites the page with every thought not in it yet, then lets those bubbles go.
 * Returns the new page, or null when there was nothing new.
 */
export async function digest(db: DB, now: Date = new Date()): Promise<MindPage | null> {
  const fresh = unsettled(db).slice(0, FRESH_MAX);
  if (fresh.length === 0) return null;
  const freshIds = new Set(fresh.map((t) => t.id));
  const earlier = personThoughts(listThoughts(db))
    .filter((t) => t.settledAt && !freshIds.has(t.id))
    .slice(-EARLIER_SHOWN);
  const did = recentNotes(db, "did", 8).map((n) => n.body);
  const nope = recentNotes(db, "nope", 8).map((n) => n.body);
  const user = buildDigestUser({
    page: getPage(db),
    fresh,
    earlier,
    cards: getCards(db),
    knowledge: knowledgeText(db),
    did,
    nope,
    today: now.toISOString().slice(0, 10),
  });
  const { value } = await askJson({
    system: KEEPER,
    user,
    schema: DIGEST_SCHEMA,
    maxTokens: 500,
    temperature: 0.3,
    think: true,
    timeoutMs: DIGEST_TIMEOUT_MS,
  });
  const next = parseDigest(value, [...did, ...nope]);
  return db.transaction(() => {
    // You may have ticked or turned down the step while the bird was writing: it doesn't come back.
    const answered = [...recentNotes(db, "did", 8), ...recentNotes(db, "nope", 8)].map((n) => n.body);
    const step = next.step && answered.some((a) => tooSimilar(a, next.step as string)) ? null : next.step;
    const page = savePage(db, { lines: next.lines, step });
    settle(db, [...freshIds]);
    return page;
  })();
}
