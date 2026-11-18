import { describe, expect, it } from "vitest";
import { DO, DONT, GUIDE, TOUR } from "@/lib/guide";

describe("the guide", () => {
  it("walks a newcomer through in a few short steps", () => {
    expect(TOUR.length).toBeGreaterThanOrEqual(4);
    expect(TOUR.length).toBeLessThanOrEqual(8);
    for (const step of TOUR) {
      expect(step.title.trim()).not.toBe("");
      // Short enough to read at a glance.
      expect(step.text.length).toBeLessThanOrEqual(220);
    }
    expect(new Set(TOUR.map((s) => s.title)).size).toBe(TOUR.length);
  });

  it("points only at things that are always on screen", () => {
    const targets = TOUR.flatMap((s) => (s.target ? [s.target] : []));
    expect(targets).toEqual([".composer", ".mindpage", ".whisper", ".guide-open"]);
  });

  it("says what to do and what not to, without repeating itself", () => {
    const lines = [...GUIDE.flatMap((s) => s.items), ...DO, ...DONT];
    expect(new Set(lines).size).toBe(lines.length);
    expect(DO.length).toBeGreaterThan(0);
    expect(DONT.every((d) => d.startsWith("Don't"))).toBe(true);
    for (const section of GUIDE) expect(section.items.length).toBeGreaterThan(0);
  });
});
