import { getDb, type DB } from "../db";
import { listEntries } from "../repo/diary";
import { listOpenItems } from "../repo/items";
import { listMemories } from "../repo/memories";
import { listPlaces } from "../repo/places";
import { getAllFocus } from "../repo/rooms";
import { ROOM_HEX, ROOMS } from "../rooms";
import type { SkyNode } from "./layout";

const MAX_THOUGHTS = 40;
const MAX_ITEMS_PER_ROOM = 8;
const LABEL_CHARS = 90;
const THOUGHT_COLOR = "#fff3e0";
const MEMORY_COLOR = "#cfe3ff";

export const PLACE_HEX: Readonly<Record<string, string>> = {
  meet: "#ff7aa2",
  train: "#ff9a4d",
  buy: "#ffd166",
  food: "#ffb36b",
  coffee: "#d9a27a",
  nature: "#8bd17c",
  nightlife: "#c48bff",
  learn: "#9aa5ff",
  culture: "#4fd6b0",
  other: "#e6e6e6",
};

export function snippet(text: string, max = LABEL_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Collects everything in the app as nodes for the constellation. */
export function buildSkyNodes(db: DB = getDb()): SkyNode[] {
  const items = listOpenItems(db);
  const focus = getAllFocus(db);

  const rooms: SkyNode[] = ROOMS.map((r) => {
    const count = items.filter((i) => i.room === r.id).length;
    return {
      id: `room:${r.id}`,
      kind: "room",
      label: r.name,
      detail: focus[r.id] || r.tagline,
      href: `/rooms/${r.id}`,
      room: r.id,
      color: ROOM_HEX[r.id],
      weight: Math.min(1, count / 10),
    };
  });

  const roomItems: SkyNode[] = ROOMS.flatMap((r) =>
    items
      .filter((i) => i.room === r.id)
      .slice(0, MAX_ITEMS_PER_ROOM)
      .map((i) => ({
        id: `item:${i.id}`,
        kind: "item" as const,
        label: snippet(i.title, 48),
        detail: i.detail || (i.isNext ? "This room's next step." : ""),
        href: `/rooms/${r.id}`,
        room: r.id,
        color: ROOM_HEX[r.id],
        weight: i.isNext ? 1 : 0.4,
      })),
  );

  const entries = listEntries(MAX_THOUGHTS, db);
  const thoughts: SkyNode[] = entries.map((e, idx) => ({
    id: `thought:${e.id}`,
    kind: "thought",
    label: snippet(e.body),
    detail: e.body,
    href: `/diary#entry-${e.id}`,
    room: null,
    color: THOUGHT_COLOR,
    weight: entries.length <= 1 ? 1 : 1 - idx / (entries.length - 1),
  }));

  const memories: SkyNode[] = listMemories(db).map((m) => ({
    id: `memory:${m.id}`,
    kind: "memory",
    label: snippet(m.fact, 60),
    detail: m.fact,
    href: "/me",
    room: null,
    color: MEMORY_COLOR,
    weight: 0.5,
  }));

  const places: SkyNode[] = listPlaces(db).map((p) => ({
    id: `place:${p.id}`,
    kind: "place",
    label: p.name,
    detail: [p.area, p.notes].filter(Boolean).join(" — "),
    href: "/places",
    room: null,
    color: PLACE_HEX[p.category] ?? PLACE_HEX.other,
    weight: p.status === "loved" ? 1 : 0.5,
    lat: p.lat,
    lng: p.lng,
  }));

  return [...rooms, ...roomItems, ...thoughts, ...memories, ...places];
}
