import { getDb, type DB } from "../db";
import type { RoomId } from "../rooms";

export function getRoomFocus(room: RoomId, db: DB = getDb()): string {
  const row = db.prepare("SELECT focus FROM rooms WHERE id = ?").get(room) as { focus: string } | undefined;
  return row?.focus ?? "";
}

export function getAllFocus(db: DB = getDb()): Readonly<Record<string, string>> {
  const rows = db.prepare("SELECT id, focus FROM rooms").all() as { id: string; focus: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.focus]));
}

export function setRoomFocus(room: RoomId, focus: string, db: DB = getDb()): void {
  db.prepare("UPDATE rooms SET focus = ? WHERE id = ?").run(focus, room);
}
