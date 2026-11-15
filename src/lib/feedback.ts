import { z } from "zod";
import type { DB } from "./db";
import { learnRule } from "./knowledge";
import { addNote } from "./notebook";

// Talking back to the bird without making a bubble: wave one of its questions away,
// or tell it something that goes straight into its memory.

export const TELL_MAX = 200;
const QUESTION_MAX = 200;
/** How much of the question is kept next to what you said about it. */
const ABOUT_SHOWN = 70;

export const Feedback = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skip"), question: z.string().trim().min(1).max(QUESTION_MAX) }),
  z.object({
    kind: z.literal("tell"),
    text: z.string().trim().min(1, "Tell the bird something first.").max(TELL_MAX, "That's a bit long for the bird to remember."),
    /** The bird's question this is about, if it is. */
    about: z.string().trim().max(QUESTION_MAX).nullish(),
  }),
]);
export type Feedback = z.infer<typeof Feedback>;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trim()}…` : text);

/** Keeps what you said where the bird's brain reads it before doing anything. Nothing becomes a bubble. */
export function takeFeedback(db: DB, feedback: Feedback): void {
  if (feedback.kind === "skip") {
    addNote(db, "waved", flat(feedback.question));
    return;
  }
  const text = flat(feedback.text);
  const about = feedback.about ? flat(feedback.about) : "";
  db.transaction(() => {
    if (about) {
      // What you say about a question also means: not that question again.
      addNote(db, "waved", about);
      learnRule(db, `when you asked "${clip(about, ABOUT_SHOWN)}" they said: ${text}`, null);
    } else learnRule(db, text, null);
  })();
}
