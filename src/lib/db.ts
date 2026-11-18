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
-- Big bubbles that hold small ones. 'shelf': the bird sorts your bubbles into it. 'nook': the bird's own thoughts.
CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'shelf',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Two bubbles the bird thinks belong together, and the word for why.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  word TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (a, b)
);
-- What the bird took from a bubble when it read the whole thing.
CREATE TABLE IF NOT EXISTS cards (
  thought_id INTEGER PRIMARY KEY,
  gist TEXT NOT NULL,
  subjects TEXT NOT NULL DEFAULT '[]',
  feelings TEXT NOT NULL DEFAULT '[]',
  todos TEXT NOT NULL DEFAULT '[]',
  -- Whether the bird has decided where this bubble goes since reading it.
  sorted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- What the bird knows for sure, in your own words. 'fact': a person, project or place. 'rule': something you told it to do.
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'fact',
  key TEXT,
  name TEXT,
  body TEXT NOT NULL,
  thought_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS facts_key ON facts (key) WHERE key IS NOT NULL;
-- Small things the bird suggests you do, taken from your bubbles.
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  thought_id INTEGER,
  cluster_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT
);
-- The one page the bird keeps for you: what's on your mind right now, and at most one small step.
CREATE TABLE IF NOT EXISTS page (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lines TEXT NOT NULL DEFAULT '[]',
  step TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Links you popped. The bird never draws them again.
CREATE TABLE IF NOT EXISTS unlinks (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
`;

/** Columns added after the first release. */
function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(thoughts)").all() as { name: string }[];
  // The bird's question, when a thought was written as an answer to it.
  if (!cols.some((c) => c.name === "prompt")) db.exec("ALTER TABLE thoughts ADD COLUMN prompt TEXT");
  // The shelf a bubble sits on, and who put it there ('bird' or 'you'). The bird never moves what you placed.
  if (!cols.some((c) => c.name === "cluster_id")) db.exec("ALTER TABLE thoughts ADD COLUMN cluster_id INTEGER");
  if (!cols.some((c) => c.name === "placed_by")) db.exec("ALTER TABLE thoughts ADD COLUMN placed_by TEXT");
  // The bird's old notebook was full of guesses about you that it then took for facts, and its old lines
  // repeated them. It starts over, and keeps facts from your own words now.
  if ((db.pragma("user_version", { simple: true }) as number) < 1) {
    db.exec("DELETE FROM notes");
    db.pragma("user_version = 1");
  }
  // Why the bird put a bubble where it is, in its own words.
  addColumn(db, "thoughts", "why", "TEXT");
  // What belongs on a shelf, who wrote that ('bird' or 'you'), and how many bubbles it held when the bird wrote it.
  addColumn(db, "clusters", "about", "TEXT");
  addColumn(db, "clusters", "about_by", "TEXT");
  addColumn(db, "clusters", "about_n", "INTEGER");
  // The words in each bubble that made the bird link them.
  addColumn(db, "links", "quote_a", "TEXT");
  addColumn(db, "links", "quote_b", "TEXT");
  // A step you put off comes back after this moment.
  addColumn(db, "steps", "snooze_until", "TEXT");
  // When the bird took a thought into the page. From then on its bubble no longer floats in the world.
  addColumn(db, "thoughts", "settled_at", "TEXT");
  // The bird's nook always exists.
  const nook = db.prepare("SELECT id FROM clusters WHERE kind = 'nook'").get();
  if (!nook) db.prepare("INSERT INTO clusters (name, color, kind) VALUES (?, 'butter', 'nook')").run("the bird's thoughts");
}

function addColumn(db: Database.Database, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
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
    const file = process.env.MYBRARY_DB ?? process.env.TIMEFLOW_DB ?? path.join(process.cwd(), "data", "mind.db");
    globalForDb.__mindDb = createDb(file);
  }
  return globalForDb.__mindDb;
}
