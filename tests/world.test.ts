import { describe, expect, it } from "vitest";
import { Animator, Cancelled, lerpAngle } from "@/world/anim";
import {
  INNER_SCALE,
  bubbleHome,
  bubblePreview,
  bubbleRadius,
  clampToRing,
  clusterRadius,
  looseExtent,
  memberOffset,
  nookSpot,
  packMembers,
  planPath,
  pushOut,
  shelfSpots,
} from "@/world/layout";

describe("bubble layout", () => {
  it("places bubbles deterministically, above the tube and away from the centre", () => {
    for (let i = 0; i < 200; i++) {
      const p = bubbleHome(i);
      expect(p).toEqual(bubbleHome(i));
      expect(p.y).toBeGreaterThan(2.5);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(2.6);
    }
  });

  it("keeps neighbouring bubbles apart", () => {
    const pts = Array.from({ length: 40 }, (_, i) => bubbleHome(i));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < Math.min(pts.length, i + 4); j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
        expect(d).toBeGreaterThan(1);
      }
    }
  });

  it("sizes bubbles by length within bounds", () => {
    expect(bubbleRadius("hi")).toBeCloseTo(0.42, 2);
    expect(bubbleRadius("x".repeat(100_000))).toBe(1.05);
    expect(bubbleRadius("a".repeat(400))).toBeGreaterThan(bubbleRadius("a".repeat(20)));
  });

  it("previews a thought on one line with an ellipsis", () => {
    expect(bubblePreview("  hello\n\nworld ")).toBe("hello world");
    const long = bubblePreview("word ".repeat(40), 20);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("walking routes", () => {
  const tube = { x: 0, z: 0, r: 0.75 };

  it("goes straight when nothing is in the way", () => {
    expect(planPath({ x: 2, z: 2 }, { x: 4, z: 2 }, [tube])).toEqual([{ x: 4, z: 2 }]);
  });

  it("steps around an obstacle on the route", () => {
    const route = planPath({ x: -3, z: 0.1 }, { x: 3, z: 0.1 }, [tube]);
    expect(route).toHaveLength(2);
    const detour = route[0];
    expect(Math.hypot(detour.x, detour.z)).toBeGreaterThanOrEqual(0.75);
    expect(detour.z).toBeGreaterThan(0); // stays on the side it was already passing
    expect(route[1]).toEqual({ x: 3, z: 0.1 });
  });

  it("clamps points into a ring", () => {
    expect(Math.hypot(...Object.values(clampToRing({ x: 0.1, z: 0 }, 1, 5)))).toBeCloseTo(1);
    expect(Math.hypot(...Object.values(clampToRing({ x: 30, z: 40 }, 1, 5)))).toBeCloseTo(5);
    expect(clampToRing({ x: 0, z: 0 }, 2, 5)).toEqual({ x: 2, z: 0 });
  });
});

describe("animator", () => {
  it("runs a tween to completion over time", async () => {
    const a = new Animator();
    const seen: number[] = [];
    const done = a.tween(1, (k) => seen.push(k), (k) => k);
    a.update(0.5);
    a.update(0.6);
    await done;
    expect(seen[0]).toBeCloseTo(0.5);
    expect(seen.at(-1)).toBe(1);
  });

  it("keeps tweens scheduled from inside a step", async () => {
    const a = new Animator();
    let inner: Promise<void> | null = null;
    const outer = a.tween(0.1, (k) => {
      if (k === 1) inner = a.wait(0.1);
    });
    a.update(0.2);
    await outer;
    a.update(0.2);
    await inner;
    expect(inner).not.toBeNull();
  });

  it("rejects with Cancelled when aborted", async () => {
    const a = new Animator();
    const ctl = new AbortController();
    const p = a.wait(5, ctl.signal);
    ctl.abort();
    a.update(0.1);
    await expect(p).rejects.toBeInstanceOf(Cancelled);
  });

  it("turns the short way round", () => {
    expect(lerpAngle(3, -3, 1)).toBeCloseTo(3 + (Math.PI * 2 - 6));
  });
});

describe("shelves", () => {
  it("grow with what they hold", () => {
    expect(clusterRadius([])).toBeCloseTo(0.95);
    expect(clusterRadius([0.5, 0.5, 0.5, 0.5, 0.5, 0.5])).toBeGreaterThan(clusterRadius([0.5, 0.5]));
  });

  it("keep every member fully inside the shell", () => {
    for (const n of [1, 2, 5, 12, 30]) {
      const radii = Array.from({ length: n }, (_, i) => 0.42 + (i % 4) * 0.15);
      const R = clusterRadius(radii);
      radii.forEach((r, i) => {
        const o = memberOffset(i, n, R, r);
        expect(Math.hypot(o.x, o.y, o.z) + r * INNER_SCALE).toBeLessThanOrEqual(R);
      });
    }
  });

  it("pack their bubbles without much overlap, all inside", () => {
    for (const n of [2, 3, 6, 12, 25]) {
      const radii = Array.from({ length: n }, (_, i) => 0.42 + ((i * 7) % 5) * 0.12);
      const R = clusterRadius(radii);
      const pts = packMembers(radii, R);
      expect(pts).toEqual(packMembers(radii, R));
      pts.forEach((p, i) => expect(Math.hypot(p.x, p.y, p.z) + radii[i] * INNER_SCALE).toBeLessThanOrEqual(R + 1e-6));
      let worst = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
          worst = Math.max(worst, (radii[i] + radii[j]) * INNER_SCALE - d);
        }
      }
      expect(worst).toBeLessThan(0.15);
    }
  });

  it("never overlap each other, the nook, or the loose bubbles", () => {
    const nook = nookSpot(1.4);
    const shelves = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, radius: 0.95 + (i % 3) * 0.7 }));
    const spots = [...shelfSpots(shelves, 9, nook).values()];
    expect(spots).toHaveLength(14);
    const all = [nook, ...spots];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThanOrEqual(all[i].r + all[j].r);
      }
    }
    for (const s of spots) {
      expect(Math.hypot(s.x, s.z) - s.r).toBeGreaterThanOrEqual(looseExtent(9));
      expect(s.y - s.r).toBeGreaterThan(0); // floats above the floor
    }
  });

  it("puts the first shelf right behind the tube", () => {
    const first = shelfSpots([{ id: 7, radius: 1 }], 0, null).get(7)!;
    expect(first.x).toBeCloseTo(0);
    expect(first.z).toBeLessThan(0);
  });

  it("pushes loose bubbles out of the nook", () => {
    const nook = { x: 0, y: 3, z: 0, r: 1 };
    const p = pushOut({ x: 0.5, y: 3, z: 0 }, [nook]);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(2.1);
    expect(pushOut({ x: 5, y: 3, z: 0 }, [nook])).toEqual({ x: 5, y: 3, z: 0 });
  });
});
