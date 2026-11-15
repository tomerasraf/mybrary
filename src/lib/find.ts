import type { Thought } from "./thoughts";

// Finding bubbles by the words in them. Plain matching: nothing is guessed.

export const MIN_LETTERS = 2;
const AROUND = 28;

/** A few words on each side of the match, so you can tell bubbles apart. */
export function snippet(body: string, query: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, AROUND * 2);
  const from = Math.max(0, at - AROUND);
  const to = Math.min(flat.length, at + query.length + AROUND);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to).trim()}${to < flat.length ? "…" : ""}`;
}

/** Bubbles whose words contain what you typed, newest first. */
export function findBubbles(thoughts: readonly Thought[], query: string): Thought[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_LETTERS) return [];
  return thoughts.filter((t) => t.body.toLowerCase().includes(q)).reverse();
}
