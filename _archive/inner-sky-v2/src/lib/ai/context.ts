import { getDb, type DB } from "../db";
import { listRecentCheckins } from "../repo/checkins";
import { listEntries } from "../repo/diary";
import { listOpenItems, listRecentlyDone } from "../repo/items";
import { listMemories } from "../repo/memories";
import { listPlaces } from "../repo/places";
import { getAllFocus } from "../repo/rooms";
import { localHour, todayKey, weekday } from "../time";
import { formatSnapshot } from "./snapshot";

export function userName(): string {
  return process.env.APP_USER_NAME?.trim() || "friend";
}

export function buildSnapshotText(db: DB = getDb(), now: Date = new Date()): string {
  return formatSnapshot({
    userName: userName(),
    date: todayKey(now),
    weekday: weekday(now),
    hour: localHour(now),
    memories: listMemories(db),
    focus: getAllFocus(db),
    openItems: listOpenItems(db),
    recentlyDone: listRecentlyDone(8, db),
    checkins: listRecentCheckins(7, db),
    places: listPlaces(db),
    diary: listEntries(12, db),
  });
}
