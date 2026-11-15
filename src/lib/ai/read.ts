import { z } from "zod";
import { saveCard, unread, type NewCard } from "../cards";
import type { DB } from "../db";
import { learnFact, learnRule } from "../knowledge";
import type { Thought } from "../thoughts";
import { grounded, mentions, nameKey } from "./ground";
import { askJson } from "./llm";
import { languageOf } from "./ponder";
import { BusyError, oneAtATime } from "./queue";
import { describeOne, shelfToDescribe } from "./shelves";

// The bird reads a whole bubble, once, and keeps a card about it. Everything else it does works
// from these cards, so it knows what a long bubble is really about instead of only its first line.

const READER = `You are a careful little librarian bird. A person wrote or said a thought out loud, and you are reading all of it so you can file it properly later. Spoken thoughts ramble and have typos: read for what they mean.

You only write down what the thought actually says. You never guess, add, or read between the lines.`;

const TASK = `Fill in a card for this thought.

gist: what it is about, in 1 or 2 plain sentences (at most 40 words). Cover the whole thought, not just its start. Say "they" for the person. Use the names they use.
subjects: the proper names this thought is about: a person's name, a product's or project's name, a company's name, a place's name. Spelled as they spell them. Up to 5. Never roles or common words ("my boss", "a friend", "the game", "work"). Empty when it names nothing.
facts: for your memory: every proper name this thought explains gets a fact saying what it IS (who a person is to them, what a company, game or project is). "name" is a proper name from subjects, "what" is one short plain phrase in the person's own terms. Only things stated in this thought. Up to 4. Empty when nothing is explained.
feelings: feelings the person puts into words themselves. "feeling" is a few words, "quote" is their exact words from the thought. Empty when they don't state a feeling. Never infer one.
todos: things they say they want, need or plan to do. "todo" starts with a verb, "quote" is their exact words from the thought. Empty when they don't say one.
to_bird: only when the thought speaks to YOU, the bird ("i want you to…", "remember that…", "keep in mind…", "don't mix…") and tells you to do or remember something about the library. "rule" is that instruction as one short clear sentence that still makes sense on its own later: write the actual names instead of "this", "that" or "it". "quote" is their exact words. Otherwise both are empty strings.`;

export const READ_SCHEMA = {
  type: "object",
  properties: {
    gist: { type: "string" },
    subjects: { type: "array", items: { type: "string" } },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, what: { type: "string" } },
        required: ["name", "what"],
        additionalProperties: false,
      },
    },
    feelings: {
      type: "array",
      items: {
        type: "object",
        properties: { feeling: { type: "string" }, quote: { type: "string" } },
        required: ["feeling", "quote"],
        additionalProperties: false,
      },
    },
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: { todo: { type: "string" }, quote: { type: "string" } },
        required: ["todo", "quote"],
        additionalProperties: false,
      },
    },
    to_bird: {
      type: "object",
      properties: { rule: { type: "string" }, quote: { type: "string" } },
      required: ["rule", "quote"],
      additionalProperties: false,
    },
  },
  required: ["gist", "subjects", "facts", "feelings", "todos", "to_bird"],
  additionalProperties: false,
} as const;

/** How much of one bubble the bird reads. Longer than almost anything a person says in one go. */
const BODY_MAX = 7000;
const GIST_MAX = 320;
const MAX_SUBJECTS = 5;
const MAX_FACTS = 4;
const MAX_FEELINGS = 3;
const MAX_TODOS = 3;
const READ_TIMEOUT_MS = 150_000;

const flat = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

export function buildReadUser(thought: Thought): string {
  const lang = languageOf(thought.body);
  const parts: string[] = [];
  if (thought.prompt) parts.push(`<your_question note="the thought answers this">${flat(thought.prompt, 300)}</your_question>`);
  parts.push(`<thought ${thought.source === "spoken" ? 'spoken="yes"' : ""}>\n${thought.body.slice(0, BODY_MAX)}\n</thought>`);
  parts.push(`${TASK}\n\nWrite the gist, facts, feelings and todos in ${lang ?? "the thought's own language"}.`);
  return parts.join("\n\n");
}

const Raw = z.object({
  gist: z.string(),
  subjects: z.array(z.string()).default([]),
  facts: z.array(z.object({ name: z.string(), what: z.string() })).default([]),
  feelings: z.array(z.object({ feeling: z.string(), quote: z.string() })).default([]),
  todos: z.array(z.object({ todo: z.string(), quote: z.string() })).default([]),
  to_bird: z.object({ rule: z.string(), quote: z.string() }).optional(),
});

export interface Reading {
  card: NewCard;
  facts: { name: string; what: string }[];
  rule: string | null;
}

/** Common words that aren't anybody's name. A fact about "the game" would mix every game together. */
const GENERIC = new Set(
  "friend friends game games work job company project boss ceo manager team girl guy man woman person people family mom dad mother father brother sister wife husband girlfriend boyfriend partner app website site platform idea ideas life home house school office money time thing things me myself bird you ai they them he she it we us i someone everyone".split(
    " ",
  ),
);
const isName = (name: string) => {
  const words = name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length > 0 && words.length <= 4 && words.some((w) => !GENERIC.has(w)) && !GENERIC.has(words[words.length - 1]);
};

/** Keeps only what the bubble really says. */
export function parseReading(value: unknown, thought: Thought): Reading {
  const raw = Raw.parse(value);
  const gist = flat(raw.gist, GIST_MAX);
  if (!gist) throw new Error("the card has no gist");
  const body = thought.body;

  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const s of raw.subjects) {
    const name = flat(s, 40).toLowerCase();
    const key = nameKey(name);
    if (!key || seen.has(key) || subjects.length >= MAX_SUBJECTS) continue;
    if (!isName(name) || !mentions(name, body)) continue;
    seen.add(key);
    subjects.push(name);
  }

  const facts = raw.facts
    .map((f) => ({ name: flat(f.name, 40), what: flat(f.what, 160) }))
    .filter((f) => f.what && isName(f.name) && mentions(f.name, body))
    .slice(0, MAX_FACTS);
  const feelings = raw.feelings
    .filter((f) => f.feeling.trim() && grounded(f.quote, body))
    .map((f) => flat(f.feeling, 80))
    .slice(0, MAX_FEELINGS);
  const todos = raw.todos
    .filter((t) => t.todo.trim() && grounded(t.quote, body))
    .map((t) => flat(t.todo, 140))
    .slice(0, MAX_TODOS);
  const told = raw.to_bird;
  const rule = told && told.rule.trim() && grounded(told.quote, body) ? flat(told.rule, 200) : null;

  // A bubble that tells the bird what to do is the bird's job, not something for the person to do.
  return { card: { thoughtId: thought.id, gist, subjects, feelings, todos: rule ? [] : todos }, facts, rule };
}

/** Reads one bubble with the brain and saves its card, and anything it teaches the bird. */
export async function readThought(db: DB, thought: Thought): Promise<Reading> {
  const { value } = await askJson({
    system: READER,
    user: buildReadUser(thought),
    schema: READ_SCHEMA,
    maxTokens: 700,
    temperature: 0.15,
    think: true,
    timeoutMs: READ_TIMEOUT_MS,
  });
  const reading = parseReading(value, thought);
  db.transaction(() => {
    // The bubble may have been deleted while the bird was reading.
    if (!db.prepare("SELECT 1 FROM thoughts WHERE id = ?").get(thought.id)) return;
    saveCard(db, reading.card);
    for (const f of reading.facts) learnFact(db, f.name, f.what, thought.id);
    if (reading.rule) learnRule(db, reading.rule, thought.id);
  })();
  return reading;
}

// ---------- reading in the background ----------

const state = globalThis as unknown as {
  __birdReading?: boolean;
  __birdReadFails?: Map<number, number>;
  __birdShelfTried?: Set<number>;
};
const MAX_TRIES = 2;
const BUSY_WAIT_MS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bubbles still waiting to be read (that the bird hasn't given up on). */
export function waitingToBeRead(db: DB): Thought[] {
  const fails = (state.__birdReadFails ??= new Map());
  return unread(db).filter((t) => (fails.get(t.id) ?? 0) < MAX_TRIES);
}

/**
 * Starts reading unread bubbles, oldest first, one at a time, sharing the brain with everything else.
 * Returns at once. `delayMs` lets the bird react to a brand new bubble before it sits down to read it.
 */
export function startReading(db: DB, delayMs = 0): void {
  if (state.__birdReading) return;
  state.__birdReading = true;
  const fails = (state.__birdReadFails ??= new Map());
  void (async () => {
    try {
      if (delayMs > 0) await sleep(delayMs);
      for (;;) {
        const [next] = waitingToBeRead(db);
        // With everything read, it writes down what each shelf holds (one try per shelf per run).
        const tried = (state.__birdShelfTried ??= new Set());
        const shelf = next ? null : [shelfToDescribe(db)].find((s) => s && !tried.has(s.id));
        if (!next && !shelf) return;
        try {
          if (next) await oneAtATime(() => readThought(db, next));
          else if (shelf) {
            tried.add(shelf.id);
            await oneAtATime(() => describeOne(db, shelf));
          }
        } catch (error) {
          if (error instanceof BusyError) {
            if (shelf) tried.delete(shelf.id);
            await sleep(BUSY_WAIT_MS);
            continue;
          }
          if (next) {
            console.error(`[bird] couldn't read bubble ${next.id}`, error);
            fails.set(next.id, (fails.get(next.id) ?? 0) + 1);
          } else console.error("[bird] couldn't describe a shelf", error);
        }
      }
    } finally {
      state.__birdShelfTried = new Set();
      state.__birdReading = false;
    }
  })();
}
