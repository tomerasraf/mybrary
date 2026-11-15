// The soft colours a shelf (a big bubble) can be tinted. Shared by the server and the 3D world.

export const SHELF_COLORS = {
  pearl: "#dfe4ef",
  rose: "#ffb3c8",
  peach: "#ffc8a2",
  butter: "#ffe08a",
  mint: "#9fe3c4",
  sky: "#9fd0ff",
  lilac: "#c9b6ff",
} as const;

export type ShelfColor = keyof typeof SHELF_COLORS;

export const SHELF_COLOR_KEYS = Object.keys(SHELF_COLORS) as ShelfColor[];

/** Colours the bird hands out to new shelves, in turn. */
const ROTATION: ShelfColor[] = ["sky", "mint", "rose", "lilac", "peach", "butter"];

export function colorForIndex(index: number): ShelfColor {
  return ROTATION[((index % ROTATION.length) + ROTATION.length) % ROTATION.length];
}

export function isShelfColor(value: string): value is ShelfColor {
  return value in SHELF_COLORS;
}
