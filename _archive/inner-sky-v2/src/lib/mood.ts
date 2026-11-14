/**
 * The whole app is tinted by how you feel. A "weather" is picked from your
 * latest mood + energy and drives the palette (CSS) and the sky's motion (WebGL).
 */
export const WEATHERS = ["dusk", "ember", "tide", "meadow", "bloom"] as const;
export type Weather = (typeof WEATHERS)[number];

export interface Palette {
  readonly skyTop: string;
  readonly skyBottom: string;
  readonly glow: string;
  readonly spark: string;
  readonly ink: string;
  readonly dim: string;
}

export const PALETTES: Readonly<Record<Weather, Palette>> = {
  // no recent signal: violet evening with a warm lamp
  dusk: { skyTop: "#1d1838", skyBottom: "#5c3463", glow: "#ffb36b", spark: "#86d8ff", ink: "#fbefe6", dim: "#b8a6c6" },
  // low mood, low energy: a fireplace — warm, slow, close
  ember: { skyTop: "#1a0e0b", skyBottom: "#4d2118", glow: "#ff8a3d", spark: "#ffd28a", ink: "#ffeedd", dim: "#c79c86" },
  // low mood, high energy: restless water
  tide: { skyTop: "#05202a", skyBottom: "#11505a", glow: "#5cf2d0", spark: "#ff7aa8", ink: "#e8fffb", dim: "#8fc2bf" },
  // good mood, low energy: a calm summer night in a garden
  meadow: { skyTop: "#0e2416", skyBottom: "#3a6837", glow: "#f6e27a", spark: "#ffb0c8", ink: "#f4fbe8", dim: "#a9c6a0" },
  // good mood, high energy: neon festival
  bloom: { skyTop: "#280a3d", skyBottom: "#c93f74", glow: "#ffe14d", spark: "#4de3ff", ink: "#fff6fb", dim: "#f2bad3" },
};

export const WEATHER_LABEL: Readonly<Record<Weather, string>> = {
  dusk: "Quiet dusk",
  ember: "Fireplace",
  tide: "Restless tide",
  meadow: "Garden night",
  bloom: "Festival",
};

export interface MoodSignal {
  readonly mood: number; // 1-5
  readonly energy: number | null; // 1-5, null if unknown
}

export function weatherFor(signal: MoodSignal | null): Weather {
  if (!signal) return "dusk";
  const energy = signal.energy ?? 3;
  if (signal.mood <= 2) return energy >= 4 ? "tide" : "ember";
  if (signal.mood >= 4) return energy >= 4 ? "bloom" : "meadow";
  return energy >= 4 ? "bloom" : energy <= 2 ? "ember" : "dusk";
}

/** Sky animation speed, 0.4 (sleepy) .. 1.6 (buzzing). */
export function skySpeed(signal: MoodSignal | null): number {
  const energy = signal?.energy ?? 3;
  return 0.4 + ((energy - 1) / 4) * 1.2;
}
