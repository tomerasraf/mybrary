import { getDb, type DB } from "../db";

export interface DiaryEntry {
  readonly id: number;
  readonly date: string; // YYYY-MM-DD, user's local day
  readonly body: string;
  readonly mood: number | null; // 1-5, optional
  readonly createdAt: string; // UTC "YYYY-MM-DD HH:MM:SS"
}

interface Row {
  id: number;
  date: string;
  body: string;
  mood: number | null;
  created_at: string;
}

const toEntry = (r: Row): DiaryEntry => ({
  id: r.id,
  date: r.date,
  body: r.body,
  mood: r.mood,
  createdAt: r.created_at,
});

export function addEntry(input: { date: string; body: string; mood: number | null }, db: DB = getDb()): DiaryEntry {
  const info = db.prepare("INSERT INTO diary (date, body, mood) VALUES (?, ?, ?)").run(input.date, input.body, input.mood);
  return getEntry(Number(info.lastInsertRowid), db)!;
}

export function getEntry(id: number, db: DB = getDb()): DiaryEntry | null {
  const row = db.prepare("SELECT * FROM diary WHERE id = ?").get(id) as Row | undefined;
  return row ? toEntry(row) : null;
}

export function listEntries(limit: number, db: DB = getDb()): DiaryEntry[] {
  const rows = db.prepare("SELECT * FROM diary ORDER BY id DESC LIMIT ?").all(limit) as Row[];
  return rows.map(toEntry);
}

export function searchEntries(query: string, limit: number, db: DB = getDb()): DiaryEntry[] {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = db
    .prepare("SELECT * FROM diary WHERE body LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?")
    .all(`%${escaped}%`, limit) as Row[];
  return rows.map(toEntry);
}

export function updateEntry(id: number, body: string, db: DB = getDb()): void {
  db.prepare("UPDATE diary SET body = ? WHERE id = ?").run(body, id);
}

export function deleteEntry(id: number, db: DB = getDb()): void {
  db.prepare("DELETE FROM diary WHERE id = ?").run(id);
}

/** Groups entries (already newest-first) by day, preserving order. */
export function groupByDay(entries: readonly DiaryEntry[]): { date: string; entries: DiaryEntry[] }[] {
  return entries.reduce<{ date: string; entries: DiaryEntry[] }[]>((groups, entry) => {
    const last = groups[groups.length - 1];
    return last && last.date === entry.date
      ? [...groups.slice(0, -1), { date: last.date, entries: [...last.entries, entry] }]
      : [...groups, { date: entry.date, entries: [entry] }];
  }, []);
}
