import { z } from "zod";
import { getCards, type Card } from "../cards";
import type { DB } from "../db";
import { knowledgeText } from "../knowledge";
import { personThoughts } from "../library";
import { listThoughts, type Thought } from "../thoughts";
import { grounded } from "./ground";
import { askJson } from "./llm";
import { languageOf } from "./ponder";

// You ask the bird about your own bubbles. It answers only from what they say, and shows which
// bubbles it used. If they don't say, it tells you so instead of making something up.

export const QUESTION_MAX = 300;
export const ANSWER_MAX = 240;
/** Bubbles the bird reads in full for one question. */
const READ_IN_FULL = 5;
const FULL_SHOWN = 900;
/** Bubbles it sees a summary of. */
const SUMMARIES = 40;
const MAX_USED = 4;

export const Question = z.object({
  question: z.string().trim().min(2, "Ask the bird something first.").max(QUESTION_MAX, "That's a long question. Shorter?"),
});

export interface Answer {
  /** Null when the bubbles don't say. */
  answer: string | null;
  /** The bubbles the answer comes from. */
  ids: number[];
}

const SYSTEM = `You are a tiny bird with round glasses who keeps a library of thought bubbles. Each bubble is something the person you live with wrote or said. They are asking you a question about their own bubbles.

You answer only from what the bubbles and what_you_know say. You never guess, advise or add anything of your own. If the bubbles don't answer the question, you say nothing.`;

const TASK = `Answer their question from the bubbles.

- "found": the bubbles that answer it (at most ${MAX_USED}). For each: "bubble" is its id, "quote" is the exact words from that bubble that answer the question, copied as written. Empty when no bubble answers it.
- "answer": one or two short sentences, at most 35 words, lowercase, speaking to the person as "you". Only what the quotes say. Empty when "found" is empty.`;

export const ASK_SCHEMA = {
  type: "object",
  properties: {
    found: {
      type: "array",
      items: {
        type: "object",
        properties: { bubble: { type: "integer" }, quote: { type: "string" } },
        required: ["bubble", "quote"],
        additionalProperties: false,
      },
    },
    answer: { type: "string" },
  },
  required: ["found", "answer"],
  additionalProperties: false,
} as const;

/** Words that say nothing about what a question is after. */
const STOP = new Set(
  "the and you your are but for not with this that what when where which who whom why how did does was were have has had about from say said says tell told ever any some there their they them its mine all can could would should bubble bubbles think thought write wrote written".split(
    " ",
  ),
);
const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));

/** The bubbles most likely to hold the answer: the ones that share the question's own words. Best first. */
export function relevant(question: string, thoughts: readonly Thought[], cards: ReadonlyMap<number, Card>, limit = READ_IN_FULL): Thought[] {
  const asked = [...new Set(words(question))];
  if (asked.length === 0) return [];
  return thoughts
    .map((t) => {
      const card = cards.get(t.id);
      const text = `${t.body} ${card?.gist ?? ""} ${card?.subjects.join(" ") ?? ""}`.toLowerCase();
      return { t, score: asked.filter((w) => text.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || y.t.id - x.t.id)
    .slice(0, limit)
    .map((x) => x.t);
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export function buildAskUser(question: string, thoughts: readonly Thought[], cards: ReadonlyMap<number, Card>, knowledge: string): string {
  const close = relevant(question, thoughts, cards);
  const closeIds = new Set(close.map((t) => t.id));
  const rest = thoughts.filter((t) => !closeIds.has(t.id)).slice(-SUMMARIES);
  const full = close.map((t) => `<bubble id="${t.id}" date="${t.createdAt.slice(0, 10)}">${clip(t.body, FULL_SHOWN)}</bubble>`);
  const short = rest.map((t) => `<bubble id="${t.id}" date="${t.createdAt.slice(0, 10)}">${cards.get(t.id)?.gist ?? clip(t.body, 200)}</bubble>`);
  const lang = languageOf(question);
  return [
    knowledge,
    `<bubbles_in_short>\n${short.length ? short.join("\n") : "(none)"}\n</bubbles_in_short>`,
    `<bubbles_in_full note="the ones that share words with the question">\n${full.length ? full.join("\n") : "(none)"}\n</bubbles_in_full>`,
    `<their_question>${clip(question, QUESTION_MAX)}</their_question>`,
    `${TASK}${lang ? `\n- Write the answer in ${lang}.` : ""}`,
  ].join("\n\n");
}

const Raw = z.object({
  found: z.array(z.object({ bubble: z.coerce.number().int(), quote: z.string() })).default([]),
  answer: z.string().default(""),
});

/** Keeps the answer only when it points at real bubbles, with words that are really in them. */
export function parseAnswer(value: unknown, thoughts: readonly Thought[], cards: ReadonlyMap<number, Card>): Answer {
  const raw = Raw.parse(value);
  const byId = new Map(thoughts.map((t) => [t.id, t]));
  const ids: number[] = [];
  for (const f of raw.found) {
    const t = byId.get(f.bubble);
    if (!t || ids.includes(t.id) || ids.length >= MAX_USED) continue;
    // The quote may come from the bubble itself, or from the bird's summary of it when that is all it saw.
    if (grounded(f.quote, t.body) || grounded(f.quote, cards.get(t.id)?.gist ?? "")) ids.push(t.id);
  }
  const answer = clip(raw.answer.replace(/^["“']|["”']$/g, ""), ANSWER_MAX);
  return ids.length > 0 && answer ? { answer, ids } : { answer: null, ids: [] };
}

export async function askBird(db: DB, question: string): Promise<Answer> {
  const thoughts = personThoughts(listThoughts(db));
  if (thoughts.length === 0) return { answer: null, ids: [] };
  const cards = getCards(db);
  const { value } = await askJson({
    system: SYSTEM,
    user: buildAskUser(question, thoughts, cards, knowledgeText(db)),
    schema: ASK_SCHEMA,
    maxTokens: 320,
    temperature: 0.2,
  });
  return parseAnswer(value, thoughts, cards);
}
