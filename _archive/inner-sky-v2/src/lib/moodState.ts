import { getDb, type DB } from "./db";
import { getCheckin, listRecentCheckins } from "./repo/checkins";
import { listEntries } from "./repo/diary";
import { skySpeed, weatherFor, type MoodSignal, type Weather } from "./mood";
import { todayKey } from "./time";

const RECENT_DAYS = 2;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
}

/** Latest mood signal: today's check-in, else a recent diary mood, else a recent check-in. */
export function currentSignal(db: DB = getDb(), today: string = todayKey()): MoodSignal | null {
  const checkin = getCheckin(today, db);
  if (checkin) return { mood: checkin.mood, energy: checkin.energy };

  const diary = listEntries(20, db).find((e) => e.mood !== null && daysBetween(today, e.date) <= RECENT_DAYS);
  if (diary?.mood) return { mood: diary.mood, energy: null };

  const recent = listRecentCheckins(1, db)[0];
  if (recent && daysBetween(today, recent.date) <= RECENT_DAYS) return { mood: recent.mood, energy: recent.energy };
  return null;
}

export function currentWeather(db: DB = getDb()): { weather: Weather; speed: number; signal: MoodSignal | null } {
  const signal = currentSignal(db);
  return { weather: weatherFor(signal), speed: skySpeed(signal), signal };
}
