import { z } from "zod";
import type { Card } from "../cards";
import type { Note } from "../notebook";
import type { Thought } from "../thoughts";
import { grounded } from "./ground";
import { askJson } from "./llm";

/** 'new': a bubble was just born. 'wander': the bird walks over to a bubble and looks at it. */
export type PonderMode = "new" | "wander";

export interface PonderInput {
  mode: PonderMode;
  /** The bubble the bird is looking at. It reads all of it. */
  focus: Thought;
  /** Every bubble the bird can see. */
  bubbles: Thought[];
  /** What the bird took from each bubble when it read it. */
  cards: ReadonlyMap<number, Card>;
  /** What the bird knows for sure, written out for its brain. */
  knowledge: string;
  said: Note[];
  /** Questions of the bird's that the person waved away. */
  waved?: string[];
}

export interface PonderResult {
  /** The bubble the bird looks at. */
  id: number;
  line: string;
  /** Other bubbles it thinks belong with this one. */
  links: number[];
  /** The words in the bubble that caught its eye. */
  detail: string;
}

export const LINE_MAX = 160;
const MAX_LINKS = 3;

export const PERSONA = `You are a tiny bird with round glasses who lives in a white, quiet world full of floating thought bubbles. Each bubble is something the person you live with wrote or said out loud. This library is all you know. You look at the bubbles to help them see their own mind clearly: what keeps coming back, which thoughts belong together, what they said they want to do next.

The one rule: you only go by what is written in the bubbles and in what_you_know. Never guess at feelings, fears or motives they did not write down themselves. If a bubble is happy, don't look for a worry in it.

First pick the "detail": the few exact words from this bubble that catch your eye the most (a name, a number, a plan, something odd or sweet). Copy them exactly as written.

Then say your "line" about that detail:
- One short line, at most 15 words. Lowercase. You're a small, curious, slightly silly bird, not a therapist.
- It is about the detail you picked. Never generic encouragement, advice, lists or therapy-speak (no "it sounds like", "you fear", "you're seeking"). No emoji.
- Do one of these: enjoy the detail out loud; point out that another bubble mentions the same thing; or ask one small, concrete question about it that they could answer in a sentence. Ask a question about a third of the time.
- Never claim something is missing or was never said. Never count bubbles.
- Find a new angle every time: don't reuse the idea, the wording or the opening of a line in you_said_recently. Don't start with "you said" or "you mentioned".
- Write the line in the same language as the bubble you're looking at.

The kind of line you say (the voice, not the content; don't copy these):
- ooh, "sourdough at 6am". who gets the first slice?
- "someday" is in here twice. i like someday.
- the balcony bubble wants tomatoes too!
- which box would you unpack first?

Links: ids of up to 3 other bubbles that are clearly about the same thing as this one. Use an empty list if none are.`;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const SCRIPTS: [name: string, pattern: RegExp][] = [
  ["Hebrew", /[֐-׿]/g],
  ["Arabic", /[؀-ۿ]/g],
  ["Russian", /[Ѐ-ӿ]/g],
];

/** The language a text is mostly written in, when its alphabet gives it away (small models need the hint). */
export function languageOf(text: string): string | null {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return null;
  for (const [name, pattern] of SCRIPTS) {
    if ((text.match(pattern) ?? []).length / letters > 0.5) return name;
  }
  return null;
}

/** Words that say nothing about what a line is about. */
const FILLER = new Set(
  "the and you your are but for not with this that like what when just more about from have was all its it's they them their than then said says say mentioned bubble bubbles too one still".split(
    " ",
  ),
);

const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}']{3,}/gu) ?? []).filter((w) => !FILLER.has(w)));

/** Whether two lines say mostly the same thing in the same words. */
export function tooSimilar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}

const bubbleTag = (t: Thought, max: number) => {
  const lang = languageOf(t.body);
  const attrs = [
    `id="${t.id}"`,
    `date="${t.createdAt.slice(0, 10)}"`,
    lang ? `lang="${lang}"` : "",
    t.prompt ? `answering="${clip(t.prompt, 160).replace(/"/g, "'")}"` : "",
  ].filter(Boolean);
  return `<bubble ${attrs.join(" ")}>${clip(t.body, max)}</bubble>`;
};

export const PONDER_SCHEMA = {
  type: "object",
  properties: { detail: { type: "string" }, line: { type: "string" }, links: { type: "array", items: { type: "integer" } } },
  required: ["detail", "line", "links"],
  additionalProperties: false,
} as const;

/** How much of the bubble it's looking at the bird reads. */
const FOCUS_MAX = 4000;

export function buildUser(input: PonderInput): string {
  const said = input.said.length ? input.said.map((n) => `- ${n.body}`).join("\n") : "(nothing yet)";
  const others = input.bubbles.filter((t) => t.id !== input.focus.id);
  // The other bubbles as the bird's own summaries: the whole of each, not its first line.
  const other = (t: Thought) => `<bubble id="${t.id}">${input.cards.get(t.id)?.gist ?? clip(t.body, 240)}</bubble>`;
  const parts = [
    input.knowledge,
    `<you_said_recently>\n${said}\n</you_said_recently>`,
    ...(input.waved?.length
      ? [
          `<questions_they_waved_away note="they did not want these. never ask them, or anything like them, again">\n${input.waved
            .map((q) => `- ${q}`)
            .join("\n")}\n</questions_they_waved_away>`,
        ]
      : []),
    `<other_bubbles>\n${others.length ? others.map(other).join("\n") : "(none)"}\n</other_bubbles>`,
    `<this_bubble>\n${bubbleTag(input.focus, FOCUS_MAX)}\n</this_bubble>`,
  ];
  const lang = languageOf(input.focus.body);
  if (lang) parts.push(`This bubble is written in ${lang}. Read it carefully, and write your line in ${lang}.`);
  parts.push(
    input.mode === "wander"
      ? "You walked over to this bubble and are looking up at it. Read all of it, then say what you notice about it."
      : input.focus.prompt
        ? "This new bubble is their answer to your question. React to what they told you as you watch it float up."
        : "This bubble was just born. React to it as you watch it float up.",
  );
  return parts.join("\n\n");
}

const Raw = z.object({
  detail: z.string().optional().default(""),
  line: z.string(),
  links: z.array(z.coerce.number().int()).optional().default([]),
});

/** Checks the model's answer against the bubbles that really exist. Throws on anything unusable. */
export function parsePonder(value: unknown, input: PonderInput): PonderResult {
  const raw = Raw.parse(value);
  const ids = new Set(input.bubbles.map((t) => t.id));
  const id = input.focus.id;
  const line = clip(raw.line.trim().replace(/^["“']|["”']$/g, ""), LINE_MAX);
  if (!line) throw new Error("empty line");
  const links = [...new Set(raw.links)].filter((l) => l !== id && ids.has(l)).slice(0, MAX_LINKS);
  return { id, line, links, detail: raw.detail.trim() };
}

/** What's wrong with a line, if anything: the wrong language, or something the bird already said. */
export function problemWith(result: PonderResult, input: PonderInput): string | null {
  const lang = languageOf(input.focus.body);
  if (!grounded(result.detail, input.focus.body)) return "the detail must be words copied exactly from this bubble";
  if (lang && languageOf(result.line) !== lang) return `bubble ${result.id} is written in ${lang}, so the line must be in ${lang}`;
  const waved = result.line.endsWith("?") ? input.waved?.find((q) => tooSimilar(q, result.line)) : undefined;
  if (waved) return `they waved away the question "${waved}"; don't ask it again, say something else`;
  const repeat = input.said.find((n) => tooSimilar(n.body, result.line));
  if (repeat) return `you already said almost the same thing ("${repeat.body}"); find a different angle`;
  return null;
}

/** The bird had nothing new to say this time. Not a failure: it just looks quietly. */
export class RepeatError extends Error {
  constructor() {
    super("the bird has nothing new to say right now");
    this.name = "RepeatError";
  }
}

/** A little more adventurous on the second try, so it doesn't land on the same idea again. */
const RETRY_TEMPERATURE = 1.05;

export async function ponder(input: PonderInput): Promise<PonderResult> {
  const user = buildUser(input);
  const ask = async (extra: string, temperature?: number) => {
    const { value } = await askJson({ system: PERSONA, user: user + extra, schema: PONDER_SCHEMA, temperature, maxTokens: 200 });
    return parsePonder(value, input);
  };
  const first = await ask("");
  const problem = problemWith(first, input);
  if (!problem) return first;

  // One more try with the problem spelled out.
  const second = await ask(`\n\nYour first try was: "${first.line}". Problem: ${problem}. Try again.`, RETRY_TEMPERATURE);
  const still = problemWith(second, input);
  if (still?.startsWith("you already said") || still?.startsWith("they waved away")) throw new RepeatError();
  return second;
}
