import { nameKey } from "./ai/ground";
import { getCards } from "./cards";
import type { DB } from "./db";
import { personThoughts } from "./library";
import { addNote } from "./notebook";
import { listThoughts } from "./thoughts";

// What keeps coming back. The bird doesn't guess at this: it counts how many of your recent
// bubbles name the same person, project or place.

export interface Pattern {
  /** The name, as you spell it. */
  name: string;
  /** How many bubbles in the window name it. */
  count: number;
  /** Those bubbles, oldest first. */
  ids: number[];
}

export const PATTERN_DAYS = 30;
/** Fewer than this isn't a pattern yet. */
export const PATTERN_MIN = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Names that show up in at least a few of the last month's bubbles, most frequent first. */
export function patterns(db: DB, now: Date = new Date()): Pattern[] {
  const cards = getCards(db);
  const since = now.getTime() - PATTERN_DAYS * DAY_MS;
  const found = new Map<string, Pattern>();
  for (const t of personThoughts(listThoughts(db))) {
    if (Date.parse(t.createdAt) < since) continue;
    const seen = new Set<string>();
    for (const name of cards.get(t.id)?.subjects ?? []) {
      const key = nameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const p = found.get(key);
      found.set(key, p ? { ...p, count: p.count + 1, ids: [...p.ids, t.id] } : { name, count: 1, ids: [t.id] });
    }
  }
  return [...found.values()].filter((p) => p.count >= PATTERN_MIN).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;

export function patternLine(p: Pattern): string {
  return `"${p.name}" again. that's the ${ordinal(p.count)} bubble this month that mentions it.`;
}

/** How far the bird has already told you about each name: the highest count it mentioned. */
function told(db: DB): Map<string, number> {
  const rows = db.prepare("SELECT body FROM notes WHERE kind = 'pattern'").all() as { body: string }[];
  const out = new Map<string, number>();
  for (const r of rows) {
    const at = r.body.lastIndexOf(":");
    const key = r.body.slice(0, at);
    const n = Number(r.body.slice(at + 1));
    if (at > 0 && Number.isFinite(n)) out.set(key, Math.max(out.get(key) ?? 0, n));
  }
  return out;
}

/**
 * The next thing worth pointing out: a name that has come back more often than the last time the bird
 * mentioned it. Remembers that it said so. Null when there's nothing new.
 */
export function nextPattern(db: DB, now: Date = new Date()): (Pattern & { line: string }) | null {
  const said = told(db);
  const next = patterns(db, now).find((p) => p.count > (said.get(nameKey(p.name)) ?? 0));
  if (!next) return null;
  addNote(db, "pattern", `${nameKey(next.name)}:${next.count}`);
  return { ...next, line: patternLine(next) };
}
