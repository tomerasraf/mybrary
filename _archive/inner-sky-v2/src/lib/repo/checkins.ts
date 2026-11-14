import { getDb, type DB } from "../db";

export interface Checkin {
  readonly date: string;
  readonly mood: number; // 1-5
  readonly energy: number; // 1-5
  readonly note: string;
}

export function upsertCheckin(input: Checkin, db: DB = getDb()): Checkin {
  db.prepare(
    `INSERT INTO checkins (date, mood, energy, note) VALUES (@date, @mood, @energy, @note)
     ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, energy = excluded.energy, note = excluded.note`,
  ).run(input);
  return { ...input };
}

export function getCheckin(date: string, db: DB = getDb()): Checkin | null {
  const row = db.prepare("SELECT date, mood, energy, note FROM checkins WHERE date = ?").get(date) as
    | Checkin
    | undefined;
  return row ? { ...row } : null;
}

export function listRecentCheckins(limit: number, db: DB = getDb()): Checkin[] {
  const rows = db
    .prepare("SELECT date, mood, energy, note FROM checkins ORDER BY date DESC LIMIT ?")
    .all(limit) as Checkin[];
  return rows.map((r) => ({ ...r }));
}

/** Consecutive days with a check-in, ending today (or yesterday if today not done yet). */
export function checkinStreak(dates: readonly string[], today: string): number {
  const set = new Set(dates);
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!set.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
