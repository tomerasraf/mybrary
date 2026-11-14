// Shared enums safe to import from client components (no database imports here).

export const PLACE_STATUSES = ["want", "been", "loved"] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export const PLACE_CATEGORIES = [
  "meet",
  "train",
  "buy",
  "food",
  "coffee",
  "nature",
  "nightlife",
  "learn",
  "culture",
  "other",
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const MEMORY_CATEGORIES = ["about", "habit", "belief", "preference", "goal", "win", "struggle"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const ITEM_KINDS = ["task", "idea", "question", "note"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
