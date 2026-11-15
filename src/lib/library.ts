import { z } from "zod";
import { SHELF_COLOR_KEYS, colorForIndex, type ShelfColor } from "./colors";
import type { DB } from "./db";
import { toReview } from "./cards";
import { openSteps, type Step } from "./steps";
import { listThoughts, toThought, type PlacedBy, type Thought, type ThoughtRow } from "./thoughts";

// The bird's library: shelves (big bubbles) that hold your bubbles, links between bubbles,
// and the bird's own nook of thoughts.

export type ClusterKind = "shelf" | "nook";

export interface Cluster {
  id: number;
  name: string;
  color: ShelfColor;
  kind: ClusterKind;
  /** What belongs on this shelf, in a sentence. */
  about?: string | null;
  /** Who wrote that sentence. The bird never rewrites yours. */
  aboutBy?: "bird" | "you" | null;
  createdAt: string;
}

export interface Link {
  id: number;
  /** Always the smaller bubble id. */
  a: number;
  b: number;
  word: string;
  /** The words in bubble `a` and bubble `b` that made the bird link them. */
  quotes?: [string, string] | null;
  createdAt: string;
}

export interface Library {
  thoughts: Thought[];
  clusters: Cluster[];
  links: Link[];
  /** How many bubbles the bird filed before reading them properly, and wants to look at again. */
  review: number;
  /** Small steps the bird suggested that are still waiting for you. */
  steps: Step[];
}

/** One thing the bird did while tidying, in the order it acts them out. */
export type TidyStep =
  | { kind: "shelf"; cluster: Cluster }
  /** `from` is where the bubble was (null: loose). `clusterId` null means the bird takes it off its shelf. */
  | { kind: "file"; thoughtId: number; clusterId: number | null; from: number | null }
  | { kind: "link"; link: Link };

export interface TidyResult {
  steps: TidyStep[];
  /** What the bird says when it's done, if anything. */
  line: string | null;
  /** The bird is still reading some bubbles, and will have more to sort soon. */
  reading?: boolean;
}

export const SHELF_NAME_MAX = 28;
export const LINK_WORD_MAX = 24;
export const BIRD_THOUGHT_MAX = 400;
export const SHELF_ABOUT_MAX = 160;
export const WHY_MAX = 220;

export const ShelfPatch = z
  .object({
    name: z
      .string()
      .transform((s) => s.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Give it a name.").max(SHELF_NAME_MAX, "That name is a bit long."))
      .optional(),
    color: z.enum(SHELF_COLOR_KEYS as [ShelfColor, ...ShelfColor[]]).optional(),
    /** What belongs on it. Empty hands the sentence back to the bird. */
    about: z
      .string()
      .transform((s) => s.replace(/\s+/g, " ").trim())
      .pipe(z.string().max(SHELF_ABOUT_MAX, "That's a bit long. One sentence is enough."))
      .optional(),
  })
  .refine((p) => p.name !== undefined || p.color !== undefined || p.about !== undefined, "Nothing to change.");
export type ShelfPatch = z.input<typeof ShelfPatch>;

interface ClusterRow {
  id: number;
  name: string;
  color: string;
  kind: string;
  about?: string | null;
  about_by?: string | null;
  created_at: string;
}

interface LinkRow {
  id: number;
  a: number;
  b: number;
  word: string;
  quote_a?: string | null;
  quote_b?: string | null;
  created_at: string;
}

const toCluster = (r: ClusterRow): Cluster => ({
  id: r.id,
  name: r.name,
  color: (SHELF_COLOR_KEYS as string[]).includes(r.color) ? (r.color as ShelfColor) : "pearl",
  kind: r.kind === "nook" ? "nook" : "shelf",
  about: r.about || null,
  aboutBy: r.about ? (r.about_by === "you" ? "you" : "bird") : null,
  createdAt: r.created_at,
});

const toLink = (r: LinkRow): Link => ({
  id: r.id,
  a: r.a,
  b: r.b,
  word: r.word,
  quotes: r.quote_a && r.quote_b ? [r.quote_a, r.quote_b] : null,
  createdAt: r.created_at,
});

/** One line, no doubled spaces, at most `max` characters. */
export function tidyText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

// ---------- reading ----------

export function listClusters(db: DB): Cluster[] {
  return (db.prepare("SELECT * FROM clusters ORDER BY id ASC").all() as ClusterRow[]).map(toCluster);
}

export function getCluster(db: DB, id: number): Cluster | null {
  const row = db.prepare("SELECT * FROM clusters WHERE id = ?").get(id) as ClusterRow | undefined;
  return row ? toCluster(row) : null;
}

export function nook(db: DB): Cluster {
  const row = db.prepare("SELECT * FROM clusters WHERE kind = 'nook' ORDER BY id LIMIT 1").get() as ClusterRow | undefined;
  if (!row) throw new Error("the bird's nook is missing");
  return toCluster(row);
}

export function listLinks(db: DB): Link[] {
  return (db.prepare("SELECT * FROM links ORDER BY id ASC").all() as LinkRow[]).map(toLink);
}

export function getLibrary(db: DB): Library {
  return { thoughts: listThoughts(db), clusters: listClusters(db), links: listLinks(db), review: toReview(db), steps: openSteps(db) };
}

/** Your bubbles, without the bird's own thoughts. */
export function personThoughts(thoughts: readonly Thought[]): Thought[] {
  return thoughts.filter((t) => t.source !== "bird");
}

/** Bubbles the bird may still sort: loose, and not placed there by you. */
export function sortable(thoughts: readonly Thought[]): Thought[] {
  return personThoughts(thoughts).filter((t) => t.clusterId === null && t.placedBy === null);
}

// ---------- shelves ----------

export function createShelf(db: DB, name: string, color?: ShelfColor): Cluster {
  const clean = tidyText(name, SHELF_NAME_MAX) || "things";
  const count = (db.prepare("SELECT COUNT(*) AS n FROM clusters WHERE kind = 'shelf'").get() as { n: number }).n;
  const row = db
    .prepare("INSERT INTO clusters (name, color, kind) VALUES (?, ?, 'shelf') RETURNING *")
    .get(clean, color ?? colorForIndex(count)) as ClusterRow;
  return toCluster(row);
}

export function updateShelf(db: DB, id: number, patch: ShelfPatch): Cluster | null {
  const p = ShelfPatch.parse(patch);
  const current = getCluster(db, id);
  if (!current) return null;
  const renamed = p.name !== undefined && p.name !== current.name;
  // Your sentence stays yours. The bird's goes when you rename the shelf or clear it: it writes a new one.
  let about = current.about ?? null;
  let by: "bird" | "you" | null = current.aboutBy ?? null;
  if (p.about !== undefined && p.about !== (current.about ?? "")) {
    about = p.about || null;
    by = p.about ? "you" : null;
  } else if (renamed && by === "bird") {
    about = null;
    by = null;
  }
  const row = db
    .prepare("UPDATE clusters SET name = ?, color = ?, about = ?, about_by = ? WHERE id = ? RETURNING *")
    .get(p.name ?? current.name, p.color ?? current.color, about, by, id) as ClusterRow;
  return toCluster(row);
}

/** The bird writes down what belongs on a shelf, unless you already did. `count`: how many bubbles it read. */
export function describeShelf(db: DB, id: number, about: string, count: number): boolean {
  const text = tidyText(about, SHELF_ABOUT_MAX);
  if (!text) return false;
  return (
    db
      .prepare(
        "UPDATE clusters SET about = ?, about_by = 'bird', about_n = ? WHERE id = ? AND kind = 'shelf' AND (about_by IS NULL OR about_by != 'you')",
      )
      .run(text, count, id).changes > 0
  );
}

/** Shelves whose sentence is missing, or was written by the bird when the shelf held a different number of bubbles. */
export function shelvesToDescribe(db: DB): Cluster[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM clusters c WHERE c.kind = 'shelf' AND (c.about_by IS NULL OR c.about_by != 'you')
       AND (c.about IS NULL OR c.about_n IS NULL OR c.about_n != (
         SELECT COUNT(*) FROM thoughts t JOIN cards k ON k.thought_id = t.id WHERE t.cluster_id = c.id))
       AND EXISTS (SELECT 1 FROM thoughts t JOIN cards k ON k.thought_id = t.id WHERE t.cluster_id = c.id)
       ORDER BY c.id ASC`,
    )
    .all() as ClusterRow[];
  return rows.map(toCluster);
}

/** Removes shelves nobody sits on any more. The nook stays. Returns the removed ids. */
export function pruneEmptyShelves(db: DB): number[] {
  const rows = db
    .prepare(
      "DELETE FROM clusters WHERE kind = 'shelf' AND id NOT IN (SELECT cluster_id FROM thoughts WHERE cluster_id IS NOT NULL) RETURNING id",
    )
    .all() as { id: number }[];
  return rows.map((r) => r.id);
}

export class MoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoveError";
  }
}

/**
 * Puts a bubble on a shelf (or back on the floor with null). Your bubbles never go into the bird's
 * nook, and the bird's thoughts never leave it. Empty shelves disappear.
 */
export function moveThought(db: DB, id: number, clusterId: number | null, by: PlacedBy): Thought {
  return db.transaction(() => moveNow(db, id, clusterId, by))();
}

function moveNow(db: DB, id: number, clusterId: number | null, by: PlacedBy): Thought {
  const row = db.prepare("SELECT * FROM thoughts WHERE id = ?").get(id) as ThoughtRow | undefined;
  if (!row) throw new MoveError("That bubble is gone.");
  if (row.source === "bird") throw new MoveError("That's one of the bird's own thoughts.");
  if (clusterId !== null) {
    const target = getCluster(db, clusterId);
    if (!target) throw new MoveError("That shelf is gone.");
    if (target.kind === "nook") throw new MoveError("That's the bird's own nook.");
  }
  const moved = db
    .prepare("UPDATE thoughts SET cluster_id = ?, placed_by = ?, why = NULL WHERE id = ? RETURNING *")
    .get(clusterId, by, id) as ThoughtRow;
  pruneEmptyShelves(db);
  return toThought(moved);
}

/** Deletes a bubble with its links, and any shelf it leaves empty. */
export function removeThought(db: DB, id: number): boolean {
  return db.transaction(() => {
    const gone = db.prepare("DELETE FROM thoughts WHERE id = ?").run(id).changes > 0;
    if (gone) {
      db.prepare("DELETE FROM links WHERE a = ? OR b = ?").run(id, id);
      db.prepare("DELETE FROM unlinks WHERE a = ? OR b = ?").run(id, id);
      db.prepare("DELETE FROM notes WHERE kind = 'aged' AND thought_id = ?").run(id);
      // What the bird took from it goes too: its card, the facts and rules it taught, steps it led to.
      db.prepare("DELETE FROM cards WHERE thought_id = ?").run(id);
      db.prepare("DELETE FROM facts WHERE thought_id = ?").run(id);
      db.prepare("DELETE FROM steps WHERE thought_id = ? AND status = 'open'").run(id);
      pruneEmptyShelves(db);
    }
    return gone;
  })();
}

// ---------- links ----------

/**
 * Links two bubbles with a word. Returns null for a link to itself, a missing bubble, one that exists,
 * or one you popped before. `quotes`: the words in `x` and in `y` that show the connection.
 */
export function addLink(db: DB, x: number, y: number, word: string, quotes?: [string, string]): Link | null {
  const [a, b] = x < y ? [x, y] : [y, x];
  const [qa, qb] = quotes ? (x < y ? quotes : [quotes[1], quotes[0]]).map((q) => tidyText(q, WHY_MAX)) : [null, null];
  const clean = tidyText(word, LINK_WORD_MAX).toLowerCase();
  if (a === b || !clean) return null;
  const found = db.prepare("SELECT COUNT(*) AS n FROM thoughts WHERE id IN (?, ?) AND source != 'bird'").get(a, b) as { n: number };
  if (found.n !== 2) return null;
  if (db.prepare("SELECT 1 FROM unlinks WHERE a = ? AND b = ?").get(a, b)) return null;
  const row = db
    .prepare("INSERT OR IGNORE INTO links (a, b, word, quote_a, quote_b) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(a, b, clean, qa || null, qb || null) as LinkRow | undefined;
  return row ? toLink(row) : null;
}

/** Pops a link. The bird remembers you didn't want it, and never links those two again. */
export function removeLink(db: DB, id: number): boolean {
  return db.transaction(() => {
    const row = db.prepare("DELETE FROM links WHERE id = ? RETURNING a, b").get(id) as { a: number; b: number } | undefined;
    if (!row) return false;
    db.prepare("INSERT OR IGNORE INTO unlinks (a, b) VALUES (?, ?)").run(row.a, row.b);
    return true;
  })();
}

/** Pairs you popped a link between, as "a-b" with the smaller id first. */
export function poppedPairs(db: DB): Set<string> {
  const rows = db.prepare("SELECT a, b FROM unlinks").all() as { a: number; b: number }[];
  return new Set(rows.map((r) => `${r.a}-${r.b}`));
}

// ---------- the bird's own thoughts ----------

export function createBirdThought(db: DB, body: string): Thought {
  const text = body.replace(/[ \t]+/g, " ").trim().slice(0, BIRD_THOUGHT_MAX);
  if (!text) throw new Error("the bird's thought is empty");
  const row = db
    .prepare("INSERT INTO thoughts (body, source, cluster_id, placed_by) VALUES (?, 'bird', ?, 'bird') RETURNING *")
    .get(text, nook(db).id) as ThoughtRow;
  return toThought(row);
}

export function birdThoughts(db: DB, limit: number): Thought[] {
  const rows = db
    .prepare("SELECT * FROM (SELECT * FROM thoughts WHERE source = 'bird' ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
    .all(limit) as ThoughtRow[];
  return rows.map(toThought);
}
