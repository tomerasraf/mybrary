import { describe, expect, it } from "vitest";
import { Animator, Cancelled, lerpAngle } from "@/world/anim";
import { bubbleHome, bubblePreview, bubbleRadius, clampToRing, planPath } from "@/world/layout";

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
