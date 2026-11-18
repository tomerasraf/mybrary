import { z } from "zod";
import type { DB } from "./db";

export const THOUGHT_MAX = 20_000;
export const PROMPT_MAX = 300;

export const ThoughtSource = z.enum(["written", "spoken"]);
export type ThoughtSource = z.infer<typeof ThoughtSource>;

export const NewThought = z.object({
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Say something first.").max(THOUGHT_MAX, "That's a very long thought. Split it up?")),
  source: ThoughtSource.default("written"),
  /** The bird's question this thought answers, if any. */
  prompt: z
    .string()
    .transform((s) => s.trim().slice(0, PROMPT_MAX))
    .nullish()
    .transform((s) => s || null),
});
export type NewThought = z.input<typeof NewThought>;

/** Who placed a bubble on its shelf. The bird never moves a bubble you placed. */
export type PlacedBy = "bird" | "you";

export interface Thought {
  id: number;
  body: string;
  /** 'bird': one of the bird's own thoughts, living in its nook. */
  source: ThoughtSource | "bird";
  /** The bird's question this thought answers, or null. */
  prompt: string | null;
  /** The shelf (or the bird's nook) this bubble sits in, or null when it floats loose. */
  clusterId: number | null;
  placedBy: PlacedBy | null;
  /** Why the bird put it on its shelf, in the bird's words. */
  why?: string | null;
  /** When the bird took it into the page: its bubble has floated away since. Null while it still floats. */
  settledAt?: string | null;
  createdAt: string;
}

export interface ThoughtRow {
  id: number;
  body: string;
  source: string;
  prompt: string | null;
  cluster_id: number | null;
  placed_by: string | null;
  why?: string | null;
  settled_at?: string | null;
  created_at: string;
}

export function toThought(row: ThoughtRow): Thought {
  return {
    id: row.id,
    body: row.body,
    source: row.source === "spoken" || row.source === "bird" ? row.source : "written",
    prompt: row.prompt ?? null,
    clusterId: row.cluster_id ?? null,
    placedBy: row.placed_by === "bird" || row.placed_by === "you" ? row.placed_by : null,
    why: row.why ?? null,
    settledAt: row.settled_at ?? null,
    createdAt: row.created_at,
  };
}

export function listThoughts(db: DB): Thought[] {
  const rows = db.prepare("SELECT * FROM thoughts ORDER BY id ASC").all() as ThoughtRow[];
  return rows.map(toThought);
}

export function getThought(db: DB, id: number): Thought | null {
  const row = db.prepare("SELECT * FROM thoughts WHERE id = ?").get(id) as ThoughtRow | undefined;
  return row ? toThought(row) : null;
}

export function createThought(db: DB, input: NewThought): Thought {
  const data = NewThought.parse(input);
  const row = db
    .prepare("INSERT INTO thoughts (body, source, prompt) VALUES (?, ?, ?) RETURNING *")
    .get(data.body, data.source, data.prompt) as ThoughtRow;
  return toThought(row);
}

export function deleteThought(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM thoughts WHERE id = ?").run(id).changes > 0;
}
