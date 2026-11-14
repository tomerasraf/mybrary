import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS thoughts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'written',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- The bird's notebook: what it has come to understand ('note') and what it has said out loud ('said').
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  thought_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

/** Columns added after the first release. */
function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(thoughts)").all() as { name: string }[];
  // The bird's question, when a thought was written as an answer to it.
  if (!cols.some((c) => c.name === "prompt")) db.exec("ALTER TABLE thoughts ADD COLUMN prompt TEXT");
}

export function createDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { __mindDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__mindDb) {
    const file = process.env.TIMEFLOW_DB ?? path.join(process.cwd(), "data", "mind.db");
    globalForDb.__mindDb = createDb(file);
  }
  return globalForDb.__mindDb;
}
