import type { Checkin } from "../repo/checkins";
import type { DiaryEntry } from "../repo/diary";
import type { Item } from "../repo/items";
import type { Memory } from "../repo/memories";
import type { Place } from "../repo/places";
import { ROOMS } from "../rooms";

export interface LifeSnapshot {
  readonly userName: string;
  readonly date: string;
  readonly weekday: string;
  readonly hour: number;
  readonly memories: readonly Memory[];
  readonly focus: Readonly<Record<string, string>>;
  readonly openItems: readonly Item[];
  readonly recentlyDone: readonly Item[];
  readonly checkins: readonly Checkin[];
  readonly places: readonly Place[];
  readonly diary: readonly DiaryEntry[];
}

const MAX_ITEMS_PER_ROOM = 12;
const MAX_DIARY_CHARS = 600;

function line(item: Item): string {
  const next = item.isNext ? " [NEXT STEP]" : "";
  const detail = item.detail ? ` — ${item.detail}` : "";
  return `  - #${item.id} (${item.kind}) ${item.title}${detail}${next}`;
}

/** Renders everything Ember knows about the user's current state as plain text. */
export function formatSnapshot(s: LifeSnapshot): string {
  const parts: string[] = [];
  parts.push(`Now: ${s.weekday} ${s.date}, ${String(s.hour).padStart(2, "0")}:00 local time (Israel).`);
  parts.push(`User's name: ${s.userName}.`);

  parts.push("\n## What I've learned about them");
  if (s.memories.length === 0) parts.push("(nothing yet — still getting to know them)");
  for (const m of s.memories) parts.push(`- [${m.category} #${m.id}] ${m.fact}`);

  parts.push("\n## Recent check-ins (mood/energy out of 5)");
  if (s.checkins.length === 0) parts.push("(none yet)");
  for (const c of s.checkins) {
    parts.push(`- ${c.date}: mood ${c.mood}, energy ${c.energy}${c.note ? ` — "${c.note}"` : ""}`);
  }

  parts.push("\n## Recent diary entries (newest first, their own words)");
  if (s.diary.length === 0) parts.push("(none yet)");
  for (const d of s.diary) {
    const flat = d.body.replace(/\s+/g, " ").trim();
    const body = flat.length > MAX_DIARY_CHARS ? `${flat.slice(0, MAX_DIARY_CHARS)}…` : flat;
    parts.push(`- ${d.date}${d.mood ? ` (mood ${d.mood})` : ""}: ${body}`);
  }

  parts.push("\n## Life rooms");
  for (const room of ROOMS) {
    const items = s.openItems.filter((i) => i.room === room.id).slice(0, MAX_ITEMS_PER_ROOM);
    parts.push(`### ${room.name} (${room.id})`);
    parts.push(`Focus: ${s.focus[room.id] || "(not set)"}`);
    parts.push(items.length ? items.map(line).join("\n") : "  (no open items)");
  }

  const unsorted = s.openItems.filter((i) => i.room === null);
  if (unsorted.length) {
    parts.push("\n## Unsorted brain dump");
    parts.push(unsorted.map(line).join("\n"));
  }

  if (s.recentlyDone.length) {
    parts.push("\n## Recently completed");
    for (const i of s.recentlyDone) parts.push(`- ${i.title} (${i.room ?? "unsorted"})`);
  }

  const want = s.places.filter((p) => p.status === "want");
  const loved = s.places.filter((p) => p.status === "loved");
  if (want.length || loved.length) {
    parts.push("\n## Places");
    for (const p of want) parts.push(`- want to visit: ${p.name} (${p.category}${p.area ? `, ${p.area}` : ""})`);
    for (const p of loved) parts.push(`- loved: ${p.name} (${p.category})`);
  }

  return parts.join("\n");
}
