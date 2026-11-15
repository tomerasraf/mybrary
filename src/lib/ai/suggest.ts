import { z } from "zod";
import { getCards, toReview, unread, type Card } from "../cards";
import type { DB } from "../db";
import { knowledgeText, listRules } from "../knowledge";
import { getLibrary, personThoughts, type Cluster, type Library } from "../library";
import { MAX_OPEN_STEPS, STEP_MAX, addStep, recentSteps, type Step } from "../steps";
import type { Thought } from "../thoughts";
import { askJson } from "./llm";
import { tooSimilar } from "./ponder";
import { LIBRARIAN, majorityLanguage } from "./tidy";

// The bird turns a shelf into one small thing to do. It only suggests what the bubbles on that
// shelf already point at: something the person said they want, need, or keep coming back to.

const TASK = `Suggest one small next step for the person, about this shelf.

- "reason": first, one sentence: which bubble it comes from and what they said there that points at it.
- "bubble": that bubble's id.
- "step": one sentence, at most 14 words, lowercase, starting with a verb. Something they could do today in under an hour. Say exactly what, using the names and details from the bubble.
- It is something you could watch them do: write, send, call, draw, build, book, buy, ask. Never "think about", "consider", "reflect on", "remember" or "try to".
- It must come from what they wrote: something they said they want, need, plan, or are unsure about. Never generic advice ("take a break", "reflect on it", "make a list", "talk to someone") unless that is what they wrote.
- Never repeat or reword a step from <steps_so_far>.
- If nothing on this shelf calls for doing anything, "step" is an empty string. That's fine.`;

export const STEP_SCHEMA = {
  type: "object",
  properties: { reason: { type: "string" }, bubble: { type: "integer" }, step: { type: "string" } },
  required: ["reason", "bubble", "step"],
  additionalProperties: false,
} as const;

const HISTORY = 12;
/** Steps nobody can tick off: there's nothing to see when they're done. */
const VAGUE_START = /^(think|consider|reflect|ponder|remember|try|keep|be|stay|focus|continue)\b/i;
/** After the bird suggested something for a shelf, it leaves that shelf alone for a while. */
const SHELF_REST_MS = 12 * 60 * 60 * 1000;
const MEMBERS_SHOWN = 10;

/** Shelves the bird could suggest a step for: read bubbles on them, and nothing suggested lately. */
export function shelvesToSuggestFor(lib: Library, cards: ReadonlyMap<number, Card>, steps: readonly Step[], now = Date.now()): Cluster[] {
  if (steps.filter((s) => s.status === "open").length >= MAX_OPEN_STEPS) return [];
  const mine = personThoughts(lib.thoughts);
  const busy = new Set(
    steps.filter((s) => s.status === "open" || now - Date.parse(s.createdAt) < SHELF_REST_MS).map((s) => s.clusterId),
  );
  return lib.clusters.filter(
    (c) => c.kind === "shelf" && !busy.has(c.id) && mine.some((t) => t.clusterId === c.id && cards.has(t.id)),
  );
}

export function buildStepUser(
  shelf: Cluster,
  members: readonly Thought[],
  cards: ReadonlyMap<number, Card>,
  knowledge: string,
  steps: readonly Step[],
): string {
  const bubbles = members.flatMap((t) => {
    const card = cards.get(t.id);
    if (!card) return [];
    const lines = [`about: ${card.gist}`];
    if (card.todos.length) lines.push(`they said they want to: ${card.todos.join("; ")}`);
    if (card.feelings.length) lines.push(`they said they feel: ${card.feelings.join("; ")}`);
    return [`<bubble id="${t.id}" date="${t.createdAt.slice(0, 10)}">\n${lines.join("\n")}\n</bubble>`];
  });
  const past = steps.map((s) => `- ${s.body} (${s.status === "open" ? "still waiting" : s.status})`);
  const lang = majorityLanguage(members);
  return [
    knowledge,
    `<shelf name="${shelf.name}">\n${bubbles.join("\n")}\n</shelf>`,
    `<steps_so_far>\n${past.length ? past.join("\n") : "(none yet)"}\n</steps_so_far>`,
    `${TASK}${lang ? `\n- Write the step in ${lang}.` : ""}`,
  ].join("\n\n");
}

const Raw = z.object({ bubble: z.coerce.number().int(), step: z.string() });

/** The step and the bubble it came from, or null when there's nothing worth suggesting. */
export function parseStep(
  value: unknown,
  members: readonly Thought[],
  steps: readonly Step[],
): { body: string; thoughtId: number } | null {
  const raw = Raw.parse(value);
  const body = raw.step
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“']|["”']$/g, "")
    .replace(/\.$/, "")
    .slice(0, STEP_MAX)
    .trim();
  if (body.split(" ").length < 2 || VAGUE_START.test(body)) return null;
  if (steps.some((s) => tooSimilar(s.body, body))) return null;
  // A wrong id isn't worth losing a good step over: it's about this shelf either way.
  const from = members.find((t) => t.id === raw.bubble) ?? members[members.length - 1];
  return from ? { body, thoughtId: from.id } : null;
}

/** The bird picks a shelf and suggests one small thing to do about it. Null when it has nothing. */
export async function suggestStep(db: DB): Promise<Step | null> {
  // Not while it's still reading or re-sorting: a step should come from a library it understands.
  if (unread(db).length > 0 || toReview(db) > 0) return null;
  const lib = getLibrary(db);
  // A bubble that told the bird what to do is the bird's job, not a source of steps for the person.
  const told = new Set(listRules(db).map((r) => r.thoughtId));
  const cards = new Map([...getCards(db)].filter(([id]) => !told.has(id)));
  const steps = recentSteps(db, HISTORY);
  const shelves = shelvesToSuggestFor(lib, cards, steps);
  if (shelves.length === 0) return null;
  // Shelves where the person said they want something come first.
  const wants = (c: Cluster) => lib.thoughts.some((t) => t.clusterId === c.id && (cards.get(t.id)?.todos.length ?? 0) > 0);
  const pool = shelves.some(wants) ? shelves.filter(wants) : shelves;
  const shelf = pool[Math.floor(Math.random() * pool.length)];
  const members = personThoughts(lib.thoughts)
    .filter((t) => t.clusterId === shelf.id && cards.has(t.id))
    .slice(-MEMBERS_SHOWN);

  const { value } = await askJson({
    system: LIBRARIAN,
    user: buildStepUser(shelf, members, cards, knowledgeText(db), steps),
    schema: STEP_SCHEMA,
    maxTokens: 260,
    temperature: 0.5,
  });
  const step = parseStep(value, members, steps);
  if (!step) return null;
  // The shelf may have popped while the bird was thinking.
  const still = db.prepare("SELECT 1 FROM clusters WHERE id = ?").get(shelf.id);
  return addStep(db, step.body, step.thoughtId, still ? shelf.id : null);
}
