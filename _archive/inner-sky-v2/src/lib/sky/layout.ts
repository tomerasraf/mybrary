import { ROOM_IDS, type RoomId } from "../rooms";

/** Everything you've put into TimeFlow, as points in your sky. Client-safe. */
export type NodeKind = "room" | "item" | "thought" | "memory" | "place";

export interface SkyNode {
  readonly id: string; // stable, e.g. "thought:12"
  readonly kind: NodeKind;
  readonly label: string;
  readonly detail: string;
  readonly href: string;
  readonly room: RoomId | null;
  readonly color: string; // CSS color
  readonly weight: number; // 0..1, how prominent
  readonly lat?: number | null;
  readonly lng?: number | null;
}

export type Vec3 = readonly [number, number, number];

/** Deterministic PRNG so every node keeps its place between visits. */
export function seeded(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random point on a spherical shell between rMin and rMax. */
function shellPoint(rand: () => number, rMin: number, rMax: number, flatten = 1): Vec3 {
  const u = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const r = rMin + (rMax - rMin) * Math.cbrt(rand());
  const s = Math.sqrt(1 - u * u);
  return [r * s * Math.cos(theta), r * u * flatten, r * s * Math.sin(theta)];
}

export const ROOM_RING_RADIUS = 7.5;

export function roomPosition(room: RoomId): Vec3 {
  const i = ROOM_IDS.indexOf(room);
  const angle = (i / ROOM_IDS.length) * Math.PI * 2;
  const tilt = Math.sin(angle * 2) * 1.6;
  return [Math.cos(angle) * ROOM_RING_RADIUS, tilt, Math.sin(angle) * ROOM_RING_RADIUS];
}

// Ramat Gan (Diamond Exchange area) — places are laid out around it like a map floor.
const HOME_LAT = 32.0836;
const HOME_LNG = 34.8001;
const PLACE_FLOOR_Y = -6.5;
const KM_TO_UNITS = 1.2;
const MAX_FLOOR_RADIUS = 13;

export function placePosition(node: SkyNode): Vec3 {
  if (node.lat != null && node.lng != null) {
    const dxKm = (node.lng - HOME_LNG) * 111.32 * Math.cos((HOME_LAT * Math.PI) / 180);
    const dzKm = -(node.lat - HOME_LAT) * 110.57;
    let x = dxKm * KM_TO_UNITS;
    let z = dzKm * KM_TO_UNITS;
    const d = Math.hypot(x, z);
    if (d > MAX_FLOOR_RADIUS) {
      x = (x / d) * MAX_FLOOR_RADIUS;
      z = (z / d) * MAX_FLOOR_RADIUS;
    }
    return [x, PLACE_FLOOR_Y, z];
  }
  const rand = seeded(node.id);
  const a = rand() * Math.PI * 2;
  const r = 3 + rand() * 8;
  return [Math.cos(a) * r, PLACE_FLOOR_Y, Math.sin(a) * r];
}

export function nodePosition(node: SkyNode): Vec3 {
  const rand = seeded(node.id);
  switch (node.kind) {
    case "room":
      return roomPosition(node.room!);
    case "item": {
      const center: Vec3 = node.room ? roomPosition(node.room) : [0, 3.5, 0];
      const p = shellPoint(rand, 1.2, 2.4);
      return [center[0] + p[0], center[1] + p[1], center[2] + p[2]];
    }
    case "thought": {
      // Recent / weighty thoughts drift closer to you at the centre.
      const near = 4.5 + (1 - node.weight) * 7;
      return shellPoint(rand, near, near + 4, 0.6);
    }
    case "memory":
      return shellPoint(rand, 14, 17, 0.8);
    case "place":
      return placePosition(node);
  }
}

/** Visual size of a node's light. */
export function nodeSize(node: SkyNode): number {
  switch (node.kind) {
    case "room":
      return 1.6 + node.weight * 1.4;
    case "thought":
      return 0.55 + node.weight * 0.5;
    case "item":
      return 0.38;
    case "memory":
      return 0.32;
    case "place":
      return 0.5;
  }
}
