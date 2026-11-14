// Pure geometry for the world: where things live. No three.js here, so it is easy to test.

export interface Vec2 {
  x: number;
  z: number;
}
export interface Vec3 extends Vec2 {
  y: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Deterministic 0..1 noise from an integer. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Where the bubble with this slot index floats. Spreads outward in a golden spiral as the mind fills up. */
export function bubbleHome(index: number): Vec3 {
  const angle = index * GOLDEN_ANGLE + 0.6;
  const radius = 2.7 + 1.05 * Math.sqrt(index) + hash01(index) * 0.6;
  const y = 2.6 + hash01(index + 17) * 2.4 + Math.min(index, 60) * 0.03;
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
}

/** Bigger thoughts make bigger bubbles, within reason. */
export function bubbleRadius(text: string): number {
  return Math.min(1.05, Math.max(0.42, 0.36 + Math.sqrt(text.length) * 0.022));
}

/** Short preview that is drawn inside a bubble. */
export function bubblePreview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export interface Obstacle extends Vec2 {
  r: number;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  return { d: Math.hypot(p.x - cx, p.z - cz), t };
}

/**
 * A walking route from `from` to `to` that steps around round obstacles.
 * One detour point per obstacle crossed is plenty for a small, open world.
 */
export function planPath(from: Vec2, to: Vec2, obstacles: readonly Obstacle[]): Vec2[] {
  const detours: { t: number; p: Vec2 }[] = [];
  for (const o of obstacles) {
    const { d, t } = distToSegment(o, from, to);
    if (d >= o.r || t <= 0 || t >= 1) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    // Push the closest point of the route out to the obstacle's edge, on the side it was already passing.
    let ax = from.x + dx * t - o.x;
    let az = from.z + dz * t - o.z;
    if (Math.hypot(ax, az) < 1e-4) {
      ax = -dz;
      az = dx;
    }
    const len = Math.hypot(ax, az) || 1;
    const reach = o.r + 0.25;
    detours.push({ t, p: { x: o.x + (ax / len) * reach, z: o.z + (az / len) * reach } });
  }
  detours.sort((a, b) => a.t - b.t);
  return [...detours.map((d) => d.p), to];
}

/** Keep a point inside a ring around the centre, so walks stay on the visible floor. */
export function clampToRing(p: Vec2, min: number, max: number): Vec2 {
  const r = Math.hypot(p.x, p.z);
  if (r < 1e-6) return { x: min, z: 0 };
  const k = Math.min(max, Math.max(min, r)) / r;
  return { x: p.x * k, z: p.z * k };
}
