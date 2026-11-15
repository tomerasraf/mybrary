import type { DB } from "./db";
import { toThought, type Thought, type ThoughtRow } from "./thoughts";

// Bubbles grow old. After a while the bird dusts one off and asks whether it's still true,
// once, and then leaves it alone for a good while.

/** A bubble this old starts to look faded. */
export const OLD_AFTER_DAYS = 45;
/** By this age it is as faded as it gets. */
export const FADED_AFTER_DAYS = 150;
/** The bird doesn't ask about the same bubble again for this long. */
export const ASK_AGAIN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How faded a bubble is, 0 (fresh) to 1 (as old as they get). */
export function fadedness(createdAt: string, now: number = Date.now()): number {
  const days = (now - Date.parse(createdAt)) / DAY_MS;
  if (!Number.isFinite(days) || days <= OLD_AFTER_DAYS) return 0;
  return Math.min(1, (days - OLD_AFTER_DAYS) / (FADED_AFTER_DAYS - OLD_AFTER_DAYS));
}

export function agedLine(createdAt: string, now: Date = new Date()): string {
  const then = new Date(createdAt);
  const month = then.toLocaleString("en", { month: "long" }).toLowerCase();
  const when = then.getFullYear() === now.getFullYear() ? month : `${month} ${then.getFullYear()}`;
  return `*blows the dust off* this one is from ${when}. still true?`;
}

/**
 * The oldest of your bubbles the bird hasn't asked about lately, with its question. Remembers that it
 * asked. Null when nothing is old enough.
 */
export function nextAged(db: DB, now: Date = new Date()): { thought: Thought; line: string } | null {
  const oldBefore = new Date(now.getTime() - OLD_AFTER_DAYS * DAY_MS).toISOString();
  const askedSince = new Date(now.getTime() - ASK_AGAIN_DAYS * DAY_MS).toISOString();
  const row = db
    .prepare(
      `SELECT * FROM thoughts WHERE source != 'bird' AND created_at < ?
       AND id NOT IN (SELECT thought_id FROM notes WHERE kind = 'aged' AND thought_id IS NOT NULL AND created_at > ?)
       ORDER BY id ASC LIMIT 1`,
    )
    .get(oldBefore, askedSince) as ThoughtRow | undefined;
  if (!row) return null;
  const thought = toThought(row);
  const line = agedLine(thought.createdAt, now);
  db.prepare("INSERT INTO notes (kind, body, thought_id, created_at) VALUES ('aged', ?, ?, ?)").run(line, thought.id, now.toISOString());
  return { thought, line };
}
