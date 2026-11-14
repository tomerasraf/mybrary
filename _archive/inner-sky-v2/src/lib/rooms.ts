export const ROOM_IDS = ["love", "body", "kitchen", "home", "game", "money"] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export interface RoomDef {
  readonly id: RoomId;
  readonly name: string;
  readonly emoji: string;
  readonly tagline: string;
  readonly defaultFocus: string;
  readonly color: string; // CSS variable name for the room accent
}

export const ROOMS: readonly RoomDef[] = [
  {
    id: "love",
    name: "Love & People",
    emoji: "🌷",
    tagline: "Connection, friends, dating",
    defaultFocus: "Meet new people in Gush Dan — one social thing a week.",
    color: "--room-love",
  },
  {
    id: "body",
    name: "Body",
    emoji: "🏋️",
    tagline: "Strength, movement, energy",
    defaultFocus: "Build the habit: 3 short strength sessions a week.",
    color: "--room-body",
  },
  {
    id: "kitchen",
    name: "Kitchen",
    emoji: "🍳",
    tagline: "Learn to cook, eat well",
    defaultFocus: "Cook one new recipe every week.",
    color: "--room-kitchen",
  },
  {
    id: "home",
    name: "Home",
    emoji: "🪴",
    tagline: "Make the apartment yours",
    defaultFocus: "Add one thing a week that makes home feel cozy.",
    color: "--room-home",
  },
  {
    id: "game",
    name: "Game → Steam",
    emoji: "🎮",
    tagline: "Ship your game",
    defaultFocus: "Define the smallest shippable version of the game.",
    color: "--room-game",
  },
  {
    id: "money",
    name: "Money",
    emoji: "🌱",
    tagline: "Learn to invest",
    defaultFocus: "Learn the basics: emergency fund, index funds, fees.",
    color: "--room-money",
  },
];

export function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && (ROOM_IDS as readonly string[]).includes(value);
}

export function getRoom(id: string): RoomDef | undefined {
  return ROOMS.find((r) => r.id === id);
}

/** Room light colours (hex, for WebGL). Mirrors the --room-* CSS variables. */
export const ROOM_HEX: Readonly<Record<RoomId, string>> = {
  love: "#ff7aa2",
  body: "#ff9a4d",
  kitchen: "#ffd166",
  home: "#8bd17c",
  game: "#9aa5ff",
  money: "#4fd6b0",
};
