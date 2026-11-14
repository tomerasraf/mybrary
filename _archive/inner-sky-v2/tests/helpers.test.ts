import { describe, expect, it } from "vitest";
import { formatSnapshot } from "@/lib/ai/snapshot";
import { skySpeed, weatherFor } from "@/lib/mood";
import { passcodeToken, safeEqual } from "@/lib/passcode";
import { getRoom, isRoomId } from "@/lib/rooms";
import { nodePosition, placePosition, roomPosition, seeded, type SkyNode } from "@/lib/sky/layout";
import { snippet } from "@/lib/sky/nodes";
import { dayPart, greeting, isWeekend, localHour, todayKey, weekday } from "@/lib/time";

describe("time", () => {
  const instant = new Date("2026-11-11T22:30:00Z"); // 00:30 on the 12th in Israel (UTC+2)

  it("uses the Israel timezone for today", () => {
    expect(todayKey(instant, "Asia/Jerusalem")).toBe("2026-11-12");
    expect(todayKey(instant, "UTC")).toBe("2026-11-11");
    expect(localHour(instant, "Asia/Jerusalem")).toBe(0);
    expect(weekday(instant, "Asia/Jerusalem")).toBe("Thursday");
  });

  it("maps hours to day parts and greetings", () => {
    expect(dayPart(7)).toBe("morning");
    expect(dayPart(13)).toBe("afternoon");
    expect(dayPart(19)).toBe("evening");
    expect(dayPart(2)).toBe("night");
    expect(greeting("night")).toBe("Still up");
  });

  it("knows the Israeli weekend", () => {
    expect(isWeekend("Friday")).toBe(true);
    expect(isWeekend("Sunday")).toBe(false);
  });
});

describe("mood weather", () => {
  it("defaults to dusk without a signal", () => {
    expect(weatherFor(null)).toBe("dusk");
  });

  it("maps mood and energy to a weather", () => {
    expect(weatherFor({ mood: 1, energy: 1 })).toBe("ember");
    expect(weatherFor({ mood: 2, energy: 5 })).toBe("tide");
    expect(weatherFor({ mood: 5, energy: 2 })).toBe("meadow");
    expect(weatherFor({ mood: 5, energy: 5 })).toBe("bloom");
    expect(weatherFor({ mood: 3, energy: 3 })).toBe("dusk");
    expect(weatherFor({ mood: 4, energy: null })).toBe("meadow");
  });

  it("scales sky speed with energy", () => {
    expect(skySpeed({ mood: 3, energy: 1 })).toBeCloseTo(0.4);
    expect(skySpeed({ mood: 3, energy: 5 })).toBeCloseTo(1.6);
    expect(skySpeed(null)).toBeCloseTo(1.0);
  });
});

describe("sky layout", () => {
  const node = (over: Partial<SkyNode>): SkyNode => ({
    id: "thought:1",
    kind: "thought",
    label: "x",
    detail: "",
    href: "/",
    room: null,
    color: "#fff",
    weight: 1,
    ...over,
  });

  it("is deterministic per id", () => {
    expect(seeded("a")()).toBe(seeded("a")());
    expect(seeded("a")()).not.toBe(seeded("b")());
    expect(nodePosition(node({}))).toEqual(nodePosition(node({})));
  });

  it("puts rooms on a ring and items near their room", () => {
    const r = roomPosition("kitchen");
    expect(Math.hypot(r[0], r[2])).toBeCloseTo(7.5);
    const p = nodePosition(node({ id: "item:4", kind: "item", room: "kitchen" }));
    expect(Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2])).toBeLessThanOrEqual(2.41);
  });

  it("keeps recent thoughts closer to the centre", () => {
    const near = nodePosition(node({ id: "thought:9", weight: 1 }));
    const far = nodePosition(node({ id: "thought:9", weight: 0 }));
    expect(Math.hypot(...near)).toBeLessThan(Math.hypot(...far));
  });

  it("lays places on the map floor by coordinates, clamped", () => {
    const home = placePosition(node({ id: "place:1", kind: "place", lat: 32.0836, lng: 34.8001 }));
    expect(home[0]).toBeCloseTo(0, 5);
    expect(home[2]).toBeCloseTo(0, 5);
    const telAvivBeach = placePosition(node({ id: "place:2", kind: "place", lat: 32.08, lng: 34.767 }));
    expect(telAvivBeach[0]).toBeLessThan(0); // west
    const eilat = placePosition(node({ id: "place:3", kind: "place", lat: 29.55, lng: 34.95 }));
    expect(Math.hypot(eilat[0], eilat[2])).toBeCloseTo(13);
  });
});

describe("snippet", () => {
  it("flattens whitespace and truncates", () => {
    expect(snippet("a\n\n b")).toBe("a b");
    expect(snippet("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("rooms", () => {
  it("validates room ids", () => {
    expect(isRoomId("kitchen")).toBe(true);
    expect(isRoomId("garage")).toBe(false);
    expect(isRoomId(3)).toBe(false);
    expect(getRoom("game")?.name).toBe("Game → Steam");
  });
});

describe("passcode", () => {
  it("hashes deterministically and compares safely", async () => {
    const a = await passcodeToken("hunter2");
    expect(a).toHaveLength(64);
    expect(a).toBe(await passcodeToken("hunter2"));
    expect(safeEqual(a, await passcodeToken("hunter3"))).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("formatSnapshot", () => {
  const base = {
    userName: "Sam",
    date: "2026-11-11",
    weekday: "Wednesday",
    hour: 20,
    memories: [],
    focus: { kitchen: "One recipe a week" },
    openItems: [],
    recentlyDone: [],
    checkins: [],
    places: [],
    diary: [],
  };

  it("handles an empty life gracefully", () => {
    const text = formatSnapshot(base);
    expect(text).toContain("Wednesday 2026-11-11, 20:00");
    expect(text).toContain("still getting to know them");
    expect(text).toContain("Focus: One recipe a week");
    expect(text).toContain("Focus: (not set)");
    expect(text).not.toContain("Unsorted brain dump");
  });

  it("includes diary, items, check-ins and places", () => {
    const text = formatSnapshot({
      ...base,
      memories: [{ id: 3, fact: "Gets energy from mornings", category: "habit", createdAt: "" }],
      openItems: [
        {
          id: 7,
          room: "kitchen",
          kind: "task",
          title: "Cook shakshuka",
          detail: "",
          status: "open",
          isNext: true,
          createdAt: "",
          doneAt: null,
        },
      ],
      checkins: [{ date: "2026-11-11", mood: 2, energy: 4, note: "long day" }],
      places: [
        { id: 1, name: "Yarkon Park", category: "nature", area: "Tel Aviv", notes: "", status: "want", lat: null, lng: null },
      ],
      diary: [{ id: 1, date: "2026-11-11", body: "Felt lonely\n\nbut the run helped", mood: 2, createdAt: "" }],
    });
    expect(text).toContain("[habit #3] Gets energy from mornings");
    expect(text).toContain("#7 (task) Cook shakshuka [NEXT STEP]");
    expect(text).toContain("mood 2, energy 4");
    expect(text).toContain("2026-11-11 (mood 2): Felt lonely but the run helped");
    expect(text).toContain("want to visit: Yarkon Park (nature, Tel Aviv)");
  });
});
