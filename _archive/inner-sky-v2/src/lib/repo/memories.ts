import { getDb, type DB } from "../db";

import type { MemoryCategory } from "../constants";

export { MEMORY_CATEGORIES } from "../constants";
export type { MemoryCategory } from "../constants";

export interface Memory {
  readonly id: number;
  readonly fact: string;
  readonly category: MemoryCategory;
  readonly createdAt: string;
}

interface MemoryRow {
  id: number;
  fact: string;
  category: string;
  created_at: string;
}

const toMemory = (r: MemoryRow): Memory => ({
  id: r.id,
  fact: r.fact,
  category: r.category as MemoryCategory,
  createdAt: r.created_at,
});

export function addMemory(fact: string, category: MemoryCategory, db: DB = getDb()): Memory {
  const info = db.prepare("INSERT INTO memories (fact, category) VALUES (?, ?)").run(fact, category);
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(info.lastInsertRowid) as MemoryRow;
  return toMemory(row);
}

export function listMemories(db: DB = getDb()): Memory[] {
  const rows = db.prepare("SELECT * FROM memories ORDER BY category, created_at").all() as MemoryRow[];
  return rows.map(toMemory);
}

export function updateMemory(id: number, fact: string, db: DB = getDb()): void {
  db.prepare("UPDATE memories SET fact = ? WHERE id = ?").run(fact, id);
}

export function deleteMemory(id: number, db: DB = getDb()): void {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}

/** Applies a reflection result atomically: adds new facts, removes outdated ones. */
export function applyReflection(
  add: readonly { fact: string; category: MemoryCategory }[],
  removeIds: readonly number[],
  db: DB = getDb(),
): { added: number; removed: number } {
  let removed = 0;
  db.transaction(() => {
    const del = db.prepare("DELETE FROM memories WHERE id = ?");
    for (const id of removeIds) removed += del.run(id).changes;
    const ins = db.prepare("INSERT INTO memories (fact, category) VALUES (?, ?)");
    for (const m of add) ins.run(m.fact, m.category);
  })();
  return { added: add.length, removed };
}
