import { describe, expect, it } from "vitest";
import { BORED, daysSince, greeting, pick } from "@/lib/bird/lines";
import { parseId } from "@/lib/api";
import { createDb } from "@/lib/db";
import { THOUGHT_MAX, createThought, deleteThought, getThought, listThoughts } from "@/lib/thoughts";

describe("thoughts store", () => {
  it("saves, lists, reads and deletes thoughts", () => {
    const db = createDb(":memory:");
    const a = createThought(db, { body: "  why do i keep starting new games?  " });
    const b = createThought(db, { body: "said this out loud", source: "spoken" });
    expect(a.body).toBe("why do i keep starting new games?");
    expect(a.source).toBe("written");
    expect(b.source).toBe("spoken");
    expect(new Date(a.createdAt).toString()).not.toBe("Invalid Date");
    expect(listThoughts(db).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(getThought(db, b.id)?.body).toBe("said this out loud");
    expect(deleteThought(db, a.id)).toBe(true);
    expect(deleteThought(db, a.id)).toBe(false);
    expect(getThought(db, a.id)).toBeNull();
  });

  it("rejects empty and oversized thoughts", () => {
    const db = createDb(":memory:");
    expect(() => createThought(db, { body: "   " })).toThrow();
    expect(() => createThought(db, { body: "x".repeat(THOUGHT_MAX + 1) })).toThrow();
    expect(() => createThought(db, { body: "ok", source: "shouted" as never })).toThrow();
  });
});

describe("bird lines", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  it("counts whole days since the last thought", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("garbage", now)).toBeNull();
    expect(daysSince("2026-11-14T08:00:00Z", now)).toBe(0);
    expect(daysSince("2026-11-11T11:00:00Z", now)).toBe(3);
    expect(daysSince("2026-12-01T00:00:00Z", now)).toBe(0);
  });

  it("greets differently the longer you've been away", () => {
    const lines = [greeting(0, null), greeting(3, 0), greeting(3, 1), greeting(3, 4), greeting(3, 10), greeting(3, 90)];
    expect(new Set(lines).size).toBe(lines.length);
    expect(greeting(3, 4)).toContain("4 days");
  });

  it("picks from a list", () => {
    expect(pick(BORED, () => 0)).toBe(BORED[0]);
    expect(pick(BORED, () => 0.9999)).toBe(BORED[BORED.length - 1]);
  });
});

describe("ids", () => {
  it("accepts only positive integers", () => {
    expect(parseId("12")).toBe(12);
    expect(parseId("0")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("abc")).toBeNull();
  });
});
