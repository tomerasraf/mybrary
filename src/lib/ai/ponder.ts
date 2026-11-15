import { z } from "zod";
import type { Note } from "../notebook";
import type { Thought } from "../thoughts";
import { askJson } from "./llm";

/** 'new': a bubble was just born. 'wander': the bird picks a bubble to go and look at. */
export type PonderMode = "new" | "wander";

export interface PonderInput {
  mode: PonderMode;
  /** The new bubble (mode 'new'). */
  focus?: Thought;
  /** Every bubble the bird can see (for 'wander', also the ones it may choose from). */
  bubbles: Thought[];
  /** Bubbles it looked at recently and should not choose again. */
  avoid: number[];
  notes: Note[];
  said: Note[];
}

export interface PonderResult {
  /** The bubble the bird looks at. */
  id: number;
  line: string;
  /** Something it now understands about the person, for its notebook. Empty when nothing new. */
  note: string;
  /** Other bubbles it thinks belong with this one. */
  links: number[];
}

export const LINE_MAX = 160;
const MAX_LINKS = 3;

export const PERSONA = `You are a tiny bird with round glasses who lives in a white, quiet world full of floating thought bubbles. Each bubble is something the person you live with wrote or said out loud. You inspect the bubbles to help them untangle their mind: what keeps coming back, quiet links between thoughts, where they seem stuck, what they really want, who they are underneath.

You keep a private notebook about this person. Read it before you speak and build on it, so you grow to know them over days. Never repeat a line you already said.

How you speak (the "line"):
- One short line, at most 15 words. Lowercase. You're a small, curious, slightly silly bird, not a therapist.
- Specific to the words they actually wrote: quote or echo a detail from the bubble. Never generic encouragement, advice, lists or therapy-speak (no "it sounds like", "you're seeking", "validation"). No emoji.
- Do one thing: notice a pattern, point at a link to another bubble, or ask one small, concrete question they could answer. Ask a question about a third of the time.
- Find a new angle every time. Never reuse the idea or wording of a line in you_said_recently.
- Write the line in the same language as the bubble you're looking at.

The kind of line you say (the voice, not the content; don't copy these):
- the game and the dinner both end with people looking at you. same fear?
- three bubbles say "start". none say "finish". hmm…
- what would you cook first, if someone knocked tonight?
- this one's lighter than last week's. something shifted?

Your notebook page (the "note"): one plain sentence about something you now understand about them that isn't already in the notebook. Use an empty string if nothing is new.
Links: ids of up to 3 other bubbles that clearly belong with this one. Use an empty list if none do.`;

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
  "the and you your are but for not with this that like what when just more about from have was all its it's they them their than then".split(
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

export function schemaFor(mode: PonderMode): Record<string, unknown> {
  const props: Record<string, unknown> = {
    line: { type: "string" },
    note: { type: "string" },
    links: { type: "array", items: { type: "integer" } },
  };
  if (mode === "wander") props.visit = { type: "integer" };
  return {
    type: "object",
    properties: mode === "wander" ? { visit: props.visit, line: props.line, note: props.note, links: props.links } : props,
    required: Object.keys(props),
    additionalProperties: false,
  };
}

export function buildUser(input: PonderInput): string {
  const notebook = input.notes.length ? input.notes.map((n) => `- ${n.body}`).join("\n") : "(empty: you're just getting to know them)";
  const said = input.said.length ? input.said.map((n) => `- ${n.body}`).join("\n") : "(nothing yet)";
  const others = input.bubbles.filter((t) => t.id !== input.focus?.id);
  const parts = [
    `<notebook>\n${notebook}\n</notebook>`,
    `<you_said_recently>\n${said}\n</you_said_recently>`,
    `<bubbles>\n${others.length ? others.map((t) => bubbleTag(t, 300)).join("\n") : "(none)"}\n</bubbles>`,
  ];
  if (input.mode === "new" && input.focus) {
    parts.push(`<new_bubble>\n${bubbleTag(input.focus, 3000)}\n</new_bubble>`);
    const lang = languageOf(input.focus.body);
    if (lang) parts.push(`This bubble is written in ${lang}. Read it carefully, and write your line in ${lang}.`);
    parts.push(
      input.focus.prompt
        ? "This new bubble is their answer to your question. React to what they told you as you watch it float up."
        : "This bubble was just born. React to it as you watch it float up.",
    );
  } else {
    const avoid = input.avoid.length ? ` Don't choose ${input.avoid.join(", ")}.` : "";
    parts.push(
      `Choose one bubble to walk over to and look up at ("visit" is its id). Prefer one that connects to others, that they keep circling back to, or that your notebook says is unresolved.${avoid} Then say what you notice about it, in the bubble's language (see its lang; English if it has none).`,
    );
  }
  return parts.join("\n\n");
}

const Raw = z.object({
  visit: z.coerce.number().int().optional(),
  line: z.string(),
  note: z.string().optional().default(""),
  links: z.array(z.coerce.number().int()).optional().default([]),
});

/** Checks the model's answer against the bubbles that really exist. Throws on anything unusable. */
export function parsePonder(value: unknown, input: PonderInput): PonderResult {
  const raw = Raw.parse(value);
  const ids = new Set(input.bubbles.map((t) => t.id));
  let id: number;
  if (input.mode === "new") {
    if (!input.focus) throw new Error("no focus");
    id = input.focus.id;
  } else {
    const candidates = input.bubbles.filter((t) => !input.avoid.includes(t.id));
    const fallback = (candidates.length ? candidates : input.bubbles)[0]?.id;
    id = raw.visit !== undefined && ids.has(raw.visit) ? raw.visit : (fallback ?? -1);
    if (id < 0) throw new Error("no bubbles");
  }
  const line = clip(raw.line.trim().replace(/^["“']|["”']$/g, ""), LINE_MAX);
  if (!line) throw new Error("empty line");
  const links = [...new Set(raw.links)].filter((l) => l !== id && ids.has(l)).slice(0, MAX_LINKS);
  return { id, line, note: raw.note.trim(), links };
}

/** What's wrong with a line, if anything: the wrong language, or something the bird already said. */
export function problemWith(result: PonderResult, input: PonderInput): string | null {
  const bubble = input.bubbles.find((t) => t.id === result.id) ?? input.focus;
  const lang = bubble ? languageOf(bubble.body) : null;
  if (lang && languageOf(result.line) !== lang) return `bubble ${result.id} is written in ${lang}, so the line must be in ${lang}`;
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
    const { value } = await askJson({ system: PERSONA, user: user + extra, schema: schemaFor(input.mode), temperature });
    return parsePonder(value, input);
  };
  const first = await ask("");
  const problem = problemWith(first, input);
  if (!problem) return first;

  // One more try with the problem spelled out. When wandering, a repeat usually means that bubble is
  // talked out, so the bird may pick a different one; a wrong language keeps the same bubble.
  const repeat = problem.startsWith("you already said");
  const steer =
    input.mode !== "wander" ? "" : repeat ? ` Choose a different bubble than ${first.id}.` : ` Keep visit = ${first.id}.`;
  const second = await ask(`\n\nYour first try was: "${first.line}". Problem: ${problem}. Try again.${steer}`, RETRY_TEMPERATURE);
  if (problemWith(second, input)?.startsWith("you already said")) throw new RepeatError();
  return second;
}
