import type { DB } from "./db";

/** 'note': something the bird has come to understand. 'said': a line it said out loud. */
export type NoteKind = "note" | "said";

export interface Note {
  id: number;
  kind: NoteKind;
  body: string;
  thoughtId: number | null;
  createdAt: string;
}

export const NOTE_MAX = 280;
/** How many of each kind the notebook keeps before the oldest pages fall out. */
export const NOTEBOOK_KEEP = 300;

interface Row {
  id: number;
  kind: string;
  body: string;
  thought_id: number | null;
  created_at: string;
}

const toNote = (r: Row): Note => ({
  id: r.id,
  kind: r.kind === "said" ? "said" : "note",
  body: r.body,
  thoughtId: r.thought_id,
  createdAt: r.created_at,
});

/** Writes a page in the bird's notebook. Blank or repeated pages are skipped. Returns the note, or null. */
export function addNote(db: DB, kind: NoteKind, body: string, thoughtId: number | null = null): Note | null {
  const text = body.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  if (!text) return null;
  const last = db.prepare("SELECT body FROM notes WHERE kind = ? ORDER BY id DESC LIMIT 1").get(kind) as
    | { body: string }
    | undefined;
  if (last?.body.toLowerCase() === text.toLowerCase()) return null;

  const row = db
    .prepare("INSERT INTO notes (kind, body, thought_id) VALUES (?, ?, ?) RETURNING *")
    .get(kind, text, thoughtId) as Row;
  db.prepare(
    "DELETE FROM notes WHERE kind = ? AND id NOT IN (SELECT id FROM notes WHERE kind = ? ORDER BY id DESC LIMIT ?)",
  ).run(kind, kind, NOTEBOOK_KEEP);
  return toNote(row);
}

/** The most recent pages of one kind, oldest first. */
export function recentNotes(db: DB, kind: NoteKind, limit: number): Note[] {
  const rows = db
    .prepare("SELECT * FROM (SELECT * FROM notes WHERE kind = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
    .all(kind, limit) as Row[];
  return rows.map(toNote);
}
