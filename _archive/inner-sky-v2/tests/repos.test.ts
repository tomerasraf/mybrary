import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type DB } from "@/lib/db";
import { checkinStreak, getCheckin, listRecentCheckins, upsertCheckin } from "@/lib/repo/checkins";
import {
  createItem,
  deleteItem,
  getItem,
  listOpenItems,
  listRoomItems,
  listUnsorted,
  moveItem,
  setItemStatus,
  setNextStep,
} from "@/lib/repo/items";
import { addMemory, applyReflection, deleteMemory, listMemories, updateMemory } from "@/lib/repo/memories";
import { createPlace, deletePlace, listPlaces, setPlaceLocation, setPlaceStatus } from "@/lib/repo/places";
import { addEntry, deleteEntry, getEntry, groupByDay, listEntries, searchEntries, updateEntry } from "@/lib/repo/diary";
import { currentSignal } from "@/lib/moodState";
import Database from "better-sqlite3";
import { getAllFocus, getRoomFocus, setRoomFocus } from "@/lib/repo/rooms";
import { addMessage, clearMessages, recentMessages } from "@/lib/repo/conversation";

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("rooms", () => {
  it("seeds all six rooms with a default focus", () => {
    expect(Object.keys(getAllFocus(db))).toHaveLength(6);
    expect(getRoomFocus("kitchen", db)).toMatch(/recipe/i);
  });

  it("updates focus", () => {
    setRoomFocus("game", "Ship a demo for Next Fest", db);
    expect(getRoomFocus("game", db)).toBe("Ship a demo for Next Fest");
  });
});

describe("items", () => {
  it("creates, completes and reopens an item", () => {
    const item = createItem({ room: "body", kind: "task", title: "Go to the gym" }, db);
    expect(item.status).toBe("open");
    setItemStatus(item.id, "done", db);
    expect(getItem(item.id, db)?.status).toBe("done");
    expect(getItem(item.id, db)?.doneAt).not.toBeNull();
    setItemStatus(item.id, "open", db);
    expect(getItem(item.id, db)?.doneAt).toBeNull();
  });

  it("keeps only one next step per room", () => {
    const a = createItem({ room: "kitchen", kind: "task", title: "Buy spices" }, db);
    const b = createItem({ room: "kitchen", kind: "task", title: "Cook pasta" }, db);
    const c = createItem({ room: "body", kind: "task", title: "Run" }, db);
    setNextStep(a.id, db);
    setNextStep(c.id, db);
    setNextStep(b.id, db);
    expect(getItem(a.id, db)?.isNext).toBe(false);
    expect(getItem(b.id, db)?.isNext).toBe(true);
    expect(getItem(c.id, db)?.isNext).toBe(true);
  });

  it("clears next-step flag when completed", () => {
    const a = createItem({ room: "home", kind: "task", title: "Buy a plant" }, db);
    setNextStep(a.id, db);
    setItemStatus(a.id, "done", db);
    expect(getItem(a.id, db)?.isNext).toBe(false);
  });

  it("lists unsorted items and moves them into a room", () => {
    const a = createItem({ room: null, kind: "note", title: "random thought" }, db);
    expect(listUnsorted(db)).toHaveLength(1);
    moveItem(a.id, "love", db);
    expect(listUnsorted(db)).toHaveLength(0);
    expect(listRoomItems("love", db).map((i) => i.id)).toEqual([a.id]);
  });

  it("excludes done items from open list and deletes", () => {
    const a = createItem({ room: "money", kind: "question", title: "What is an ETF?" }, db);
    const b = createItem({ room: "money", kind: "task", title: "Open account" }, db);
    setItemStatus(b.id, "done", db);
    expect(listOpenItems(db).map((i) => i.id)).toEqual([a.id]);
    deleteItem(a.id, db);
    expect(getItem(a.id, db)).toBeNull();
  });

  it("ignores setNextStep for unsorted items", () => {
    const a = createItem({ room: null, kind: "task", title: "x" }, db);
    setNextStep(a.id, db);
    expect(getItem(a.id, db)?.isNext).toBe(false);
  });
});

describe("checkins", () => {
  it("upserts one check-in per day", () => {
    upsertCheckin({ date: "2026-11-11", mood: 2, energy: 3, note: "meh" }, db);
    upsertCheckin({ date: "2026-11-11", mood: 4, energy: 4, note: "better" }, db);
    expect(getCheckin("2026-11-11", db)).toEqual({ date: "2026-11-11", mood: 4, energy: 4, note: "better" });
    expect(listRecentCheckins(10, db)).toHaveLength(1);
  });

  it("computes streaks", () => {
    expect(checkinStreak([], "2026-11-11")).toBe(0);
    expect(checkinStreak(["2026-11-11", "2026-11-10", "2026-11-09"], "2026-11-11")).toBe(3);
    // today not done yet: yesterday's streak still counts
    expect(checkinStreak(["2026-11-10", "2026-11-09"], "2026-11-11")).toBe(2);
    expect(checkinStreak(["2026-11-11", "2026-11-09"], "2026-11-11")).toBe(1);
    expect(checkinStreak(["2026-12-01", "2026-11-30"], "2026-12-01")).toBe(2);
  });
});

describe("places", () => {
  it("creates, updates status, sorts want-first and deletes", () => {
    const a = createPlace({ name: "Park Leumi", category: "nature", area: "Ramat Gan", notes: "", lat: null, lng: null }, db);
    const b = createPlace({ name: "Some cafe", category: "coffee", area: "", notes: "", lat: 32.08, lng: 34.8 }, db);
    setPlaceStatus(a.id, "been", db);
    expect(listPlaces(db).map((p) => p.id)).toEqual([b.id, a.id]);
    expect(listPlaces(db).find((p) => p.id === b.id)).toMatchObject({ lat: 32.08, lng: 34.8 });
    setPlaceLocation(a.id, 32.1, 34.82, db);
    expect(listPlaces(db).find((p) => p.id === a.id)).toMatchObject({ lat: 32.1, lng: 34.82 });
    deletePlace(b.id, db);
    expect(listPlaces(db)).toHaveLength(1);
  });
});

describe("memories", () => {
  it("adds, edits, deletes", () => {
    const m = addMemory("Loves cozy games", "preference", db);
    updateMemory(m.id, "Loves cozy and roguelike games", db);
    expect(listMemories(db)[0].fact).toBe("Loves cozy and roguelike games");
    deleteMemory(m.id, db);
    expect(listMemories(db)).toHaveLength(0);
  });

  it("applies a reflection atomically", () => {
    const old = addMemory("Has no gym membership", "about", db);
    const result = applyReflection(
      [
        { fact: "Joined a gym in Ramat Gan", category: "win" },
        { fact: "Avoids tasks when tired", category: "habit" },
      ],
      [old.id, 9999],
      db,
    );
    expect(result).toEqual({ added: 2, removed: 1 });
    expect(
      listMemories(db)
        .map((m) => m.fact)
        .sort(),
    ).toEqual(["Avoids tasks when tired", "Joined a gym in Ramat Gan"]);
  });
});

describe("conversation", () => {
  it("returns recent messages oldest-first and clears", () => {
    addMessage("user", "hi", db);
    addMessage("assistant", "hey", db);
    addMessage("user", "help", db);
    expect(recentMessages(2, db).map((m) => m.content)).toEqual(["hey", "help"]);
    clearMessages(db);
    expect(recentMessages(10, db)).toHaveLength(0);
  });
});

describe("diary", () => {
  it("adds, edits, searches and deletes entries", () => {
    const a = addEntry({ date: "2026-11-10", body: "Long day at the studio", mood: 2 }, db);
    const b = addEntry({ date: "2026-11-11", body: "Cooked pasta, felt 100% better", mood: null }, db);
    expect(listEntries(10, db).map((e) => e.id)).toEqual([b.id, a.id]);
    updateEntry(a.id, "Long day at the studio, then a walk", db);
    expect(getEntry(a.id, db)?.body).toContain("walk");
    expect(searchEntries("pasta", 10, db).map((e) => e.id)).toEqual([b.id]);
    expect(searchEntries("100%", 10, db).map((e) => e.id)).toEqual([b.id]);
    expect(searchEntries("%", 10, db).map((e) => e.id)).toEqual([b.id]);
    deleteEntry(b.id, db);
    expect(getEntry(b.id, db)).toBeNull();
  });

  it("groups entries by day without reordering", () => {
    const e = (id: number, date: string) => ({ id, date, body: "", mood: null, createdAt: "" });
    expect(groupByDay([e(3, "2026-11-11"), e(2, "2026-11-11"), e(1, "2026-11-09")]).map((g) => [g.date, g.entries.length])).toEqual([
      ["2026-11-11", 2],
      ["2026-11-09", 1],
    ]);
  });
});

describe("mood signal", () => {
  it("prefers today's check-in, then a recent diary mood, else nothing", () => {
    expect(currentSignal(db, "2026-11-11")).toBeNull();
    addEntry({ date: "2026-11-10", body: "meh", mood: 2 }, db);
    expect(currentSignal(db, "2026-11-11")).toEqual({ mood: 2, energy: null });
    upsertCheckin({ date: "2026-11-11", mood: 5, energy: 4, note: "" }, db);
    expect(currentSignal(db, "2026-11-11")).toEqual({ mood: 5, energy: 4 });
  });

  it("ignores stale signals", () => {
    addEntry({ date: "2026-11-01", body: "old", mood: 1 }, db);
    upsertCheckin({ date: "2026-11-02", mood: 1, energy: 1, note: "" }, db);
    expect(currentSignal(db, "2026-11-11")).toBeNull();
  });
});

describe("migration", () => {
  it("adds coordinates to a places table created by v1", () => {
    const file = `${process.env.TEMP ?? "/tmp"}/timeflow-migrate-${Date.now()}.db`;
    const old = new Database(file);
    old.exec("CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other', area TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'want', created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    old.exec("INSERT INTO places (name) VALUES ('Old spot')");
    old.close();
    const migrated = createDb(file);
    expect(listPlaces(migrated)[0]).toMatchObject({ name: "Old spot", lat: null, lng: null });
    migrated.close();
  });
});
