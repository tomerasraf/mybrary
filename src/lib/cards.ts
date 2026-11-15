import type { DB } from "./db";
import { toThought, type Thought, type ThoughtRow } from "./thoughts";

// A card is what the bird took from a bubble when it read the whole thing, once.
// Sorting, linking and the bird's own thoughts work from cards, so long bubbles aren't cut short.

export interface Card {
  thoughtId: number;
  /** What the bubble is about, in a sentence or two. */
  gist: string;
  /** People, projects and places it names. */
  subjects: string[];
  /** Feelings the person put into words themselves. */
  feelings: string[];
  /** Things the person said they want or need to do. */
  todos: string[];
  /** Whether the bird has decided where this bubble goes since reading it. */
  sorted: boolean;
}

export type NewCard = Omit<Card, "sorted">;

interface Row {
  thought_id: number;
  gist: string;
  subjects: string;
  feelings: string;
  todos: string;
  sorted: number;
}

const list = (json: string): string[] => {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const toCard = (r: Row): Card => ({
  thoughtId: r.thought_id,
  gist: r.gist,
  subjects: list(r.subjects),
  feelings: list(r.feelings),
  todos: list(r.todos),
  sorted: r.sorted === 1,
});

export function saveCard(db: DB, card: NewCard): void {
  db.prepare(
    "INSERT OR REPLACE INTO cards (thought_id, gist, subjects, feelings, todos, sorted) VALUES (?, ?, ?, ?, ?, 0)",
  ).run(card.thoughtId, card.gist, JSON.stringify(card.subjects), JSON.stringify(card.feelings), JSON.stringify(card.todos));
}

/** Every card, by bubble id. */
export function getCards(db: DB): Map<number, Card> {
  const rows = db.prepare("SELECT * FROM cards").all() as Row[];
  return new Map(rows.map((r) => [r.thought_id, toCard(r)]));
}

/** Your bubbles the bird hasn't read yet, oldest first. */
export function unread(db: DB): Thought[] {
  const rows = db
    .prepare(
      "SELECT * FROM thoughts WHERE source != 'bird' AND id NOT IN (SELECT thought_id FROM cards) ORDER BY id ASC",
    )
    .all() as ThoughtRow[];
  return rows.map(toThought);
}

/** The bird has made up its mind about where this bubble goes. */
export function markSorted(db: DB, thoughtId: number): void {
  db.prepare("UPDATE cards SET sorted = 1 WHERE thought_id = ?").run(thoughtId);
}

/** Bubbles the bird filed before it had read them properly, and should look at again. */
export function toReview(db: DB): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM thoughts t JOIN cards c ON c.thought_id = t.id WHERE t.placed_by = 'bird' AND t.source != 'bird' AND t.cluster_id IS NOT NULL AND c.sorted = 0",
    )
    .get() as { n: number };
  return row.n;
}
