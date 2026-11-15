import { ok } from "@/lib/api";
import { getCards } from "@/lib/cards";
import { getDb } from "@/lib/db";
import { personThoughts } from "@/lib/library";
import { patterns } from "@/lib/patterns";
import { listThoughts } from "@/lib/thoughts";

export const runtime = "nodejs";

const LAST_SHOWN = 140;
const PATTERNS_SHOWN = 2;

export interface Welcome {
  /** The last thing you wrote, in short. */
  last: { id: number; text: string; createdAt: string } | null;
  /** Names that keep coming back this month. */
  patterns: { name: string; count: number; ids: number[] }[];
}

/** Where you left off: nothing here is guessed, it's read and counted from your bubbles. */
export function GET(): Response {
  const db = getDb();
  const mine = personThoughts(listThoughts(db));
  const latest = mine.at(-1);
  // The bird's own summary when it has read the bubble, your first words otherwise. Kept short either way.
  const flat = (latest ? (getCards(db).get(latest.id)?.gist ?? latest.body) : "").replace(/\s+/g, " ").trim();
  const text = flat.length > LAST_SHOWN ? `${flat.slice(0, LAST_SHOWN).trim()}…` : flat;
  return ok({
    last: latest ? { id: latest.id, text, createdAt: latest.createdAt } : null,
    patterns: patterns(db).slice(0, PATTERNS_SHOWN),
  } satisfies Welcome);
}
