import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ROOMS } from "./rooms";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  focus TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT,
  kind TEXT NOT NULL DEFAULT 'task',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  is_next INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS checkins (
  date TEXT PRIMARY KEY,
  mood INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  area TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'want',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  body TEXT NOT NULL,
  mood INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS diary_date ON diary(date);
`;

/** Adds columns introduced after a table was first created. */
function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(places)").all() as { name: string }[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("lat")) db.exec("ALTER TABLE places ADD COLUMN lat REAL");
  if (!has("lng")) db.exec("ALTER TABLE places ADD COLUMN lng REAL");
  db.exec("DROP TABLE IF EXISTS plans");
}

export function createDb(file: string): DB {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  const seed = db.prepare("INSERT OR IGNORE INTO rooms (id, focus) VALUES (?, ?)");
  for (const room of ROOMS) seed.run(room.id, room.defaultFocus);
  return db;
}

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { __timeflowDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__timeflowDb) {
    const file = process.env.TIMEFLOW_DB ?? path.join(process.cwd(), "data", "timeflow.db");
    globalForDb.__timeflowDb = createDb(file);
  }
  return globalForDb.__timeflowDb;
}
