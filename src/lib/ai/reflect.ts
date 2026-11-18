import { z } from "zod";
import type { Thought } from "../thoughts";
import { askJson } from "./llm";
import { languageOf, tooSimilar } from "./ponder";

// The bird listens. When a thought is born it asks the one question that helps the person see that
// thought more clearly, or it stays quiet. It says nothing else about the thought, ever.

export const KINDS = ["next", "choice", "block", "done", "tension", "feeling", "quiet"] as const;
export type ReflectKind = (typeof KINDS)[number];

export interface ReflectInput {
  /** The thought that was just born. The bird reads all of it. */
  focus: Thought;
  /** What they said before, in short, oldest first. */
  earlier: readonly { date: string; gist: string }[];
  /** The page the bird keeps: what's on their mind right now. */
  page: readonly string[];
  /** What the bird knows for sure, written out for its brain. */
  knowledge: string;
  /** Questions the bird asked lately. */
  asked: readonly string[];
  /** Questions the person waved away. */
  waved: readonly string[];
}

export interface Reflection {
  /** Null when the bird has nothing worth asking. */
  question: string | null;
  kind: ReflectKind;
}

export const QUESTION_MAX = 160;
const FOCUS_MAX = 6000;
const REFLECT_TIMEOUT_MS = 80_000;

export const LISTENER = `You are a small bird who listens while one person thinks out loud. They talk to you to untangle their own mind. You are not a therapist, a coach or a cheerleader. You are a good listener: you ask the one question that helps them see their own thought more clearly, or you stay quiet.

Reading the thought:
- Spoken thoughts ramble, and have typos and odd spellings. Read for what they mean. Never mention spelling, wording or how something is phrased.
- First work out what the thought really is: a plan, a choice they are weighing, a worry, something that happened, an idea, or just a note. Write that in "about", in a few plain words.

Then choose "kind":
- "next": they want something but did not say what they will do first. Ask what the first small step is.
- "choice": they are torn between options. Ask what would settle it.
- "block": something is hard, stuck, or keeps not happening. Ask what exactly gets in the way.
- "done": the goal is vague. Ask how they would know it is done, or good enough.
- "tension": this thought pulls against something in earlier_thoughts or on_their_mind. Name both sides in a few words and ask which one holds now.
- "feeling": something happened and they did not say how it sits with them. Ask.
- "quiet": the thought is complete as it is (a plain note, a fact, a decision already made, a question to themselves they then answer). Ask nothing.

The question:
- One question, at most 18 words, lowercase, in plain everyday words. No metaphors, no comparisons ("like a…"), no poetry, no jokes, no praise.
- About the heart of this thought, never a side detail.
- Use their own names for things. Speak to them as "you".
- Never ask what the thought already answers. Never give advice dressed as a question ("have you tried", "what if you", "could you"). Never ask "why do you feel".
- They must be able to answer it in a sentence or two, out loud, right now.
- When "kind" is "quiet", "question" is an empty string. Staying quiet is good: a bad question is worse than none.`;

export const REFLECT_SCHEMA = {
  type: "object",
  properties: {
    about: { type: "string" },
    kind: { type: "string", enum: [...KINDS] },
    question: { type: "string" },
  },
  required: ["about", "kind", "question"],
  additionalProperties: false,
} as const;

const flat = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};

const list = (items: readonly string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join("\n") : empty);

export function buildReflectUser(input: ReflectInput): string {
  const { focus } = input;
  const lang = languageOf(focus.body);
  const parts = [
    input.knowledge,
    `<on_their_mind note="the page you keep for them">\n${list(input.page, "(nothing yet)")}\n</on_their_mind>`,
    `<earlier_thoughts note="in short, oldest first">\n${list(
      input.earlier.map((e) => `${e.date}: ${flat(e.gist, 240)}`),
      "(none)",
    )}\n</earlier_thoughts>`,
  ];
  if (input.asked.length) parts.push(`<you_asked_lately note="ask something different">\n${list(input.asked, "")}\n</you_asked_lately>`);
  if (input.waved.length) {
    parts.push(`<questions_they_waved_away note="they did not want these, or anything like them">\n${list(input.waved, "")}\n</questions_they_waved_away>`);
  }
  if (focus.prompt) parts.push(`<your_question note="the new thought answers this">${flat(focus.prompt, 300)}</your_question>`);
  parts.push(
    `<new_thought date="${focus.createdAt.slice(0, 10)}"${focus.source === "spoken" ? ' spoken="yes"' : ""}>\n${focus.body.slice(0, FOCUS_MAX)}\n</new_thought>`,
  );
  parts.push(
    focus.prompt
      ? "They just answered your question. If the answer settles it, stay quiet. Only ask again if one more question would clearly help."
      : "They just said this. Ask your one question about it, or stay quiet.",
  );
  parts.push(`Write the question in ${lang ?? "the same language as the new thought"}.`);
  return parts.join("\n\n");
}

const Raw = z.object({
  about: z.string().optional().default(""),
  kind: z.string().optional().default("quiet"),
  question: z.string().optional().default(""),
});

/** A comparison ("like the bread that keeps rising"): the bird asks plainly. */
const SIMILE = /\blike (a|an|the)\b/i;
const ADVICE = /^(have you (tried|thought|considered)|what if you|why don'?t you|could you|maybe you (could|should))\b/i;

/** The model's answer, cleaned up. A quiet bird is a fine answer. */
export function parseReflection(value: unknown): Reflection {
  const raw = Raw.parse(value);
  const kind = (KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as ReflectKind) : "quiet";
  const question = raw.question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'”]+|["”'“]+$/g, "")
    .trim();
  if (kind === "quiet" || !question) return { question: null, kind: "quiet" };
  // The bird speaks in lowercase, the way it always has.
  return { question: question.slice(0, QUESTION_MAX).toLowerCase(), kind };
}

/** What's wrong with a question, if anything. */
export function problemWithQuestion(result: Reflection, input: ReflectInput): string | null {
  const q = result.question;
  if (q === null) return null;
  if (!q.endsWith("?")) return "that is not a question: end it with a question mark, or stay quiet";
  if ((q.match(/\?/g) ?? []).length > 1) return "ask one question, not several";
  if (SIMILE.test(q)) return "no comparisons: ask it plainly, or stay quiet";
  if (ADVICE.test(q)) return "that is advice dressed as a question; ask what they think, or stay quiet";
  const lang = languageOf(input.focus.body);
  if (lang && languageOf(q) !== lang) return `the thought is in ${lang}, so the question must be in ${lang}`;
  const waved = input.waved.find((w) => tooSimilar(w, q));
  if (waved) return `they waved away the question "${waved}"; ask something else, or stay quiet`;
  const repeat = input.asked.find((a) => tooSimilar(a, q));
  if (repeat) return `you already asked almost that ("${repeat}"); ask something else, or stay quiet`;
  return null;
}

/** The bird's one question about a new thought. Resolves with a null question when it stays quiet. */
export async function reflect(input: ReflectInput): Promise<Reflection> {
  const user = buildReflectUser(input);
  const ask = async (extra: string) => {
    const { value } = await askJson({
      system: LISTENER,
      user: user + extra,
      schema: REFLECT_SCHEMA,
      maxTokens: 220,
      temperature: 0.5,
      think: true,
      timeoutMs: REFLECT_TIMEOUT_MS,
    });
    return parseReflection(value);
  };
  const first = await ask("");
  const problem = problemWithQuestion(first, input);
  if (!problem) return first;
  const second = await ask(`\n\nYour first try was: "${first.question}". Problem: ${problem}. Try again.`);
  // Still not right: better to say nothing than to ask a poor question.
  return problemWithQuestion(second, input) ? { question: null, kind: "quiet" } : second;
}
