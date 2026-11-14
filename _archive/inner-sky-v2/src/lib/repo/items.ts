import { getDb, type DB } from "../db";
import type { RoomId } from "../rooms";

import type { ItemKind } from "../constants";

export { ITEM_KINDS } from "../constants";
export type { ItemKind } from "../constants";

export interface Item {
  readonly id: number;
  readonly room: RoomId | null;
  readonly kind: ItemKind;
  readonly title: string;
  readonly detail: string;
  readonly status: "open" | "done";
  readonly isNext: boolean;
  readonly createdAt: string;
  readonly doneAt: string | null;
}

interface ItemRow {
  id: number;
  room: string | null;
  kind: string;
  title: string;
  detail: string;
  status: string;
  is_next: number;
  created_at: string;
  done_at: string | null;
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    room: row.room as RoomId | null,
    kind: row.kind as ItemKind,
    title: row.title,
    detail: row.detail,
    status: row.status === "done" ? "done" : "open",
    isNext: row.is_next === 1,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

export interface NewItem {
  readonly room: RoomId | null;
  readonly kind: ItemKind;
  readonly title: string;
  readonly detail?: string;
}

export function createItem(input: NewItem, db: DB = getDb()): Item {
  const info = db
    .prepare("INSERT INTO items (room, kind, title, detail) VALUES (?, ?, ?, ?)")
    .run(input.room, input.kind, input.title, input.detail ?? "");
  return getItem(Number(info.lastInsertRowid), db)!;
}

export function getItem(id: number, db: DB = getDb()): Item | null {
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
  return row ? toItem(row) : null;
}

export function listOpenItems(db: DB = getDb()): Item[] {
  const rows = db
    .prepare("SELECT * FROM items WHERE status = 'open' ORDER BY is_next DESC, created_at DESC")
    .all() as ItemRow[];
  return rows.map(toItem);
}

export function listRoomItems(room: RoomId, db: DB = getDb()): Item[] {
  const rows = db
    .prepare(
      "SELECT * FROM items WHERE room = ? ORDER BY status = 'done', is_next DESC, created_at DESC LIMIT 200",
    )
    .all(room) as ItemRow[];
  return rows.map(toItem);
}

export function listUnsorted(db: DB = getDb()): Item[] {
  const rows = db
    .prepare("SELECT * FROM items WHERE room IS NULL AND status = 'open' ORDER BY created_at DESC")
    .all() as ItemRow[];
  return rows.map(toItem);
}

export function setItemStatus(id: number, status: "open" | "done", db: DB = getDb()): void {
  db.prepare(
    "UPDATE items SET status = ?, done_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END, is_next = CASE WHEN ? = 'done' THEN 0 ELSE is_next END WHERE id = ?",
  ).run(status, status, status, id);
}

/** Marks one item as the room's single "next step" (clears any other). */
export function setNextStep(id: number, db: DB = getDb()): void {
  const item = getItem(id, db);
  if (!item || !item.room) return;
  db.transaction(() => {
    db.prepare("UPDATE items SET is_next = 0 WHERE room = ?").run(item.room);
    db.prepare("UPDATE items SET is_next = 1 WHERE id = ?").run(id);
  })();
}

export function moveItem(id: number, room: RoomId, db: DB = getDb()): void {
  db.prepare("UPDATE items SET room = ? WHERE id = ?").run(room, id);
}

export function deleteItem(id: number, db: DB = getDb()): void {
  db.prepare("DELETE FROM items WHERE id = ?").run(id);
}

export function countDoneSince(sinceIso: string, db: DB = getDb()): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'done' AND done_at >= ?")
    .get(sinceIso) as { n: number };
  return row.n;
}

export function listRecentlyDone(limit: number, db: DB = getDb()): Item[] {
  const rows = db
    .prepare("SELECT * FROM items WHERE status = 'done' ORDER BY done_at DESC LIMIT ?")
    .all(limit) as ItemRow[];
  return rows.map(toItem);
}
