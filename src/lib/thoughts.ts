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

export interface Thought {
  id: number;
  body: string;
  source: ThoughtSource;
  /** The bird's question this thought answers, or null. */
  prompt: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  body: string;
  source: string;
  prompt: string | null;
  created_at: string;
}

function toThought(row: Row): Thought {
  return {
    id: row.id,
    body: row.body,
    source: row.source === "spoken" ? "spoken" : "written",
    prompt: row.prompt ?? null,
    createdAt: row.created_at,
  };
}

export function listThoughts(db: DB): Thought[] {
  const rows = db.prepare("SELECT * FROM thoughts ORDER BY id ASC").all() as Row[];
  return rows.map(toThought);
}

export function getThought(db: DB, id: number): Thought | null {
  const row = db.prepare("SELECT * FROM thoughts WHERE id = ?").get(id) as Row | undefined;
  return row ? toThought(row) : null;
}

export function createThought(db: DB, input: NewThought): Thought {
  const data = NewThought.parse(input);
  const row = db
    .prepare("INSERT INTO thoughts (body, source, prompt) VALUES (?, ?, ?) RETURNING *")
    .get(data.body, data.source, data.prompt) as Row;
  return toThought(row);
}

export function deleteThought(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM thoughts WHERE id = ?").run(id).changes > 0;
}
