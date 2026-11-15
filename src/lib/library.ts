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
  createdAt: string;
}

export interface Link {
  id: number;
  /** Always the smaller bubble id. */
  a: number;
  b: number;
  word: string;
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

export const ShelfPatch = z
  .object({
    name: z
      .string()
      .transform((s) => s.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1, "Give it a name.").max(SHELF_NAME_MAX, "That name is a bit long."))
      .optional(),
    color: z.enum(SHELF_COLOR_KEYS as [ShelfColor, ...ShelfColor[]]).optional(),
  })
  .refine((p) => p.name !== undefined || p.color !== undefined, "Nothing to change.");
export type ShelfPatch = z.input<typeof ShelfPatch>;

interface ClusterRow {
  id: number;
  name: string;
  color: string;
  kind: string;
  created_at: string;
}

interface LinkRow {
  id: number;
  a: number;
  b: number;
  word: string;
  created_at: string;
}

const toCluster = (r: ClusterRow): Cluster => ({
  id: r.id,
  name: r.name,
  color: (SHELF_COLOR_KEYS as string[]).includes(r.color) ? (r.color as ShelfColor) : "pearl",
  kind: r.kind === "nook" ? "nook" : "shelf",
  createdAt: r.created_at,
});

const toLink = (r: LinkRow): Link => ({ id: r.id, a: r.a, b: r.b, word: r.word, createdAt: r.created_at });

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
  const row = db
    .prepare("UPDATE clusters SET name = ?, color = ? WHERE id = ? RETURNING *")
    .get(p.name ?? current.name, p.color ?? current.color, id) as ClusterRow;
  return toCluster(row);
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
    .prepare("UPDATE thoughts SET cluster_id = ?, placed_by = ? WHERE id = ? RETURNING *")
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

/** Links two bubbles with a word. Returns null for a link to itself, a missing bubble, or one that exists. */
export function addLink(db: DB, x: number, y: number, word: string): Link | null {
  const [a, b] = x < y ? [x, y] : [y, x];
  const clean = tidyText(word, LINK_WORD_MAX).toLowerCase();
  if (a === b || !clean) return null;
  const found = db.prepare("SELECT COUNT(*) AS n FROM thoughts WHERE id IN (?, ?) AND source != 'bird'").get(a, b) as { n: number };
  if (found.n !== 2) return null;
  const row = db.prepare("INSERT OR IGNORE INTO links (a, b, word) VALUES (?, ?, ?) RETURNING *").get(a, b, clean) as
    | LinkRow
    | undefined;
  return row ? toLink(row) : null;
}

export function removeLink(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM links WHERE id = ?").run(id).changes > 0;
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
