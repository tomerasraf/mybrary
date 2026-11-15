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

// ---------- shelves (big bubbles that hold small ones) ----------

/** Bubbles shrink a little when they settle inside a shelf. */
export const INNER_SCALE = 0.78;
const MIN_SHELF_RADIUS = 0.95;

/** How big a shelf must be to hold bubbles of these radii, with room to drift. */
export function clusterRadius(memberRadii: readonly number[]): number {
  const volume = memberRadii.reduce((sum, r) => sum + (r * INNER_SCALE) ** 3, 0);
  return Math.max(MIN_SHELF_RADIUS, 1.6 * Math.cbrt(volume) + 0.22);
}

/**
 * Places bubbles of these radii inside a shelf of radius `shelfR` so they overlap as little as
 * possible: start on a Fibonacci sphere, then push overlapping pairs apart and keep everyone inside.
 * Deterministic, so the same shelf always looks the same.
 */
export function packMembers(memberRadii: readonly number[], shelfR: number): Vec3[] {
  const n = memberRadii.length;
  const r = memberRadii.map((x) => x * INNER_SCALE);
  const pts = memberRadii.map((m, i) => memberOffset(i, n, shelfR, m));
  const keepInside = (i: number) => {
    const room = Math.max(0, shelfR - r[i] - 0.06);
    const d = Math.hypot(pts[i].x, pts[i].y, pts[i].z);
    if (d > room && d > 0) {
      const k = room / d;
      pts[i] = { x: pts[i].x * k, y: pts[i].y * k, z: pts[i].z * k };
    }
  };
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const dz = pts[j].z - pts[i].z;
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const overlap = r[i] + r[j] + 0.04 - d;
        if (overlap <= 0) continue;
        const k = (overlap / d) * 0.5;
        pts[i] = { x: pts[i].x - dx * k, y: pts[i].y - dy * k, z: pts[i].z - dz * k };
        pts[j] = { x: pts[j].x + dx * k, y: pts[j].y + dy * k, z: pts[j].z + dz * k };
      }
    }
    for (let i = 0; i < n; i++) keepInside(i);
  }
  return pts;
}

/**
 * Where member `index` of `count` sits inside a shelf of radius `shelfR`, relative to its centre.
 * Spread through the volume on a Fibonacci sphere; always fully inside the shell.
 */
export function memberOffset(index: number, count: number, shelfR: number, memberR: number): Vec3 {
  if (count <= 1) return { x: 0, y: 0, z: 0 };
  const y = 1 - ((index + 0.5) / count) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const a = index * GOLDEN_ANGLE;
  const room = Math.max(0, shelfR - memberR * INNER_SCALE - 0.08);
  const d = room * Math.cbrt((index + 0.5) / count) * 0.92;
  return { x: Math.cos(a) * ring * d, y: y * d, z: Math.sin(a) * ring * d };
}

export interface ShelfSpec {
  id: number;
  radius: number;
}

export interface Spot extends Vec3 {
  r: number;
}

/** The bird's nook floats front-left of the tube, near where the bird likes to sit. */
const NOOK_DIR = { x: -0.9, z: 0.44 };

export function nookSpot(radius: number): Spot {
  const len = Math.hypot(NOOK_DIR.x, NOOK_DIR.z);
  const d = 4.4 + radius;
  return { x: (NOOK_DIR.x / len) * d, y: Math.max(2.5, radius + 1), z: (NOOK_DIR.z / len) * d, r: radius };
}

/** How far out loose bubbles reach, with `count` of them on the golden spiral. */
export function looseExtent(count: number): number {
  return 2.7 + 1.05 * Math.sqrt(Math.max(0, count - 1)) + 0.6 + 1.05;
}

const SHELF_GAP = 0.6;
const ANGLE_STEP = 0.06;

/**
 * Places shelves on rings outside the loose bubbles. The first one floats right behind the tube,
 * the rest fan out to either side, skipping the nook.
 */
export function shelfSpots(shelves: readonly ShelfSpec[], looseCount: number, nook: Spot | null): Map<number, Spot> {
  const placed: Spot[] = nook ? [nook] : [];
  const out = new Map<number, Spot>();
  let ring = Math.max(5.4, looseExtent(looseCount) + 0.6);
  for (const s of shelves) {
    let spot: Spot | null = null;
    while (!spot) {
      const dist = ring + s.radius;
      for (let k = 0; !spot && k * ANGLE_STEP <= Math.PI; k++) {
        for (const side of k === 0 ? [1] : [1, -1]) {
          const a = -Math.PI / 2 + side * k * ANGLE_STEP;
          const c = { x: Math.cos(a) * dist, y: Math.max(2.7, s.radius + 0.9), z: Math.sin(a) * dist, r: s.radius };
          if (placed.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= p.r + c.r + SHELF_GAP)) {
            spot = c;
            break;
          }
        }
      }
      if (!spot) ring += 2 * s.radius + SHELF_GAP;
    }
    placed.push(spot);
    out.set(s.id, spot);
  }
  return out;
}

/** Nudges a point (on the floor plane) out of any round area it sits in. */
export function pushOut(p: Vec3, areas: readonly Spot[], margin = 1.1): Vec3 {
  let { x, z } = p;
  for (const a of areas) {
    const dx = x - a.x;
    const dz = z - a.z;
    const d = Math.hypot(dx, dz);
    const need = a.r + margin;
    if (d >= need) continue;
    const k = d < 1e-4 ? 1 : need / d;
    x = a.x + (d < 1e-4 ? need : dx * k);
    z = a.z + (d < 1e-4 ? 0 : dz * k);
  }
  return { x, y: p.y, z };
}
