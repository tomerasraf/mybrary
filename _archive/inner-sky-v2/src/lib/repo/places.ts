import { getDb, type DB } from "../db";

import type { PlaceCategory, PlaceStatus } from "../constants";

export { PLACE_CATEGORIES, PLACE_STATUSES } from "../constants";
export type { PlaceCategory, PlaceStatus } from "../constants";

export interface Place {
  readonly id: number;
  readonly name: string;
  readonly category: PlaceCategory;
  readonly area: string;
  readonly notes: string;
  readonly status: PlaceStatus;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface NewPlace {
  readonly name: string;
  readonly category: PlaceCategory;
  readonly area: string;
  readonly notes: string;
  readonly lat: number | null;
  readonly lng: number | null;
}

export function createPlace(input: NewPlace, db: DB = getDb()): Place {
  const info = db
    .prepare("INSERT INTO places (name, category, area, notes, lat, lng) VALUES (@name, @category, @area, @notes, @lat, @lng)")
    .run(input);
  return { id: Number(info.lastInsertRowid), status: "want", ...input };
}

export function listPlaces(db: DB = getDb()): Place[] {
  const rows = db
    .prepare(
      "SELECT id, name, category, area, notes, status, lat, lng FROM places ORDER BY CASE status WHEN 'want' THEN 0 WHEN 'loved' THEN 1 ELSE 2 END, created_at DESC",
    )
    .all() as Place[];
  return rows.map((r) => ({ ...r }));
}

export function setPlaceStatus(id: number, status: PlaceStatus, db: DB = getDb()): void {
  db.prepare("UPDATE places SET status = ? WHERE id = ?").run(status, id);
}

export function deletePlace(id: number, db: DB = getDb()): void {
  db.prepare("DELETE FROM places WHERE id = ?").run(id);
}

export function setPlaceLocation(id: number, lat: number, lng: number, db: DB = getDb()): void {
  db.prepare("UPDATE places SET lat = ?, lng = ? WHERE id = ?").run(lat, lng, id);
}
