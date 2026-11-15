import { describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import {
  addLink,
  birdThoughts,
  createBirdThought,
  createShelf,
  getLibrary,
  listClusters,
  listLinks,
  moveThought,
  nook,
  pruneEmptyShelves,
  removeLink,
  removeThought,
  sortable,
  updateShelf,
} from "@/lib/library";
import { createThought, getThought } from "@/lib/thoughts";

const fresh = () => {
  const db = createDb(":memory:");
  const [a, b, c] = ["bake real bread", "sourdough starter died", "call grandma"].map((body) => createThought(db, { body }));
  return { db, a, b, c };
};

describe("the bird's nook", () => {
  it("always exists, once", () => {
    const db = createDb(":memory:");
    expect(nook(db).kind).toBe("nook");
    expect(listClusters(db).filter((c) => c.kind === "nook")).toHaveLength(1);
  });

  it("holds the bird's own thoughts, which can't be moved or linked", () => {
    const { db, a } = fresh();
    const t = createBirdThought(db, "  three bubbles about bread.   none about eating it. ");
    expect(t.source).toBe("bird");
    expect(t.body).toBe("three bubbles about bread. none about eating it.");
    expect(t.clusterId).toBe(nook(db).id);
    expect(() => moveThought(db, t.id, null, "you")).toThrow(/bird's own/);
    expect(addLink(db, a.id, t.id, "huh")).toBeNull();
    expect(birdThoughts(db, 5).map((x) => x.id)).toEqual([t.id]);
    expect(() => createBirdThought(db, "   ")).toThrow();
  });
});

describe("shelves", () => {
  it("files bubbles onto a shelf and remembers who put them there", () => {
    const { db, a, b, c } = fresh();
    const shelf = createShelf(db, "  bread   things ");
    expect(shelf.name).toBe("bread things");
    expect(shelf.kind).toBe("shelf");
    expect(shelf.color).not.toBe("pearl");

    moveThought(db, a.id, shelf.id, "bird");
    const moved = moveThought(db, b.id, shelf.id, "you");
    expect(moved.clusterId).toBe(shelf.id);
    expect(moved.placedBy).toBe("you");
    expect(sortable(getLibrary(db).thoughts).map((t) => t.id)).toEqual([c.id]);
  });

  it("keeps your bubbles out of the bird's nook and refuses missing shelves", () => {
    const { db, a } = fresh();
    expect(() => moveThought(db, a.id, nook(db).id, "you")).toThrow(/nook/);
    expect(() => moveThought(db, a.id, 999, "you")).toThrow(/gone/);
    expect(() => moveThought(db, 999, null, "you")).toThrow(/gone/);
  });

  it("lets a bubble back onto the floor, and removes shelves left empty", () => {
    const { db, a } = fresh();
    const shelf = createShelf(db, "bread");
    moveThought(db, a.id, shelf.id, "bird");
    const loose = moveThought(db, a.id, null, "you");
    expect(loose.clusterId).toBeNull();
    expect(loose.placedBy).toBe("you"); // the bird leaves it be
    expect(listClusters(db).some((c) => c.id === shelf.id)).toBe(false);
    expect(sortable(getLibrary(db).thoughts).some((t) => t.id === a.id)).toBe(false);
  });

  it("renames and recolours, and rejects nonsense", () => {
    const { db } = fresh();
    const shelf = createShelf(db, "bread");
    expect(updateShelf(db, shelf.id, { color: "rose" })?.color).toBe("rose");
    expect(updateShelf(db, shelf.id, { name: "baking" })).toMatchObject({ name: "baking", color: "rose" });
    expect(updateShelf(db, 999, { name: "x" })).toBeNull();
    expect(() => updateShelf(db, shelf.id, {})).toThrow();
    expect(() => updateShelf(db, shelf.id, { color: "neon" as never })).toThrow();
    expect(() => updateShelf(db, shelf.id, { name: "   " })).toThrow();
  });

  it("prunes only empty shelves, never the nook", () => {
    const { db, a } = fresh();
    const kept = createShelf(db, "kept");
    moveThought(db, a.id, kept.id, "bird");
    const empty = createShelf(db, "empty");
    expect(pruneEmptyShelves(db)).toEqual([empty.id]);
    expect(listClusters(db).map((c) => c.kind).sort()).toEqual(["nook", "shelf"]);
  });
});

describe("links", () => {
  it("links two bubbles once, in either order, with a short word", () => {
    const { db, a, b } = fresh();
    const link = addLink(db, b.id, a.id, "  BREAD  ");
    expect(link).toMatchObject({ a: a.id, b: b.id, word: "bread" });
    expect(addLink(db, a.id, b.id, "again")).toBeNull();
    expect(addLink(db, a.id, a.id, "self")).toBeNull();
    expect(addLink(db, a.id, 999, "ghost")).toBeNull();
    expect(addLink(db, a.id, b.id, "   ")).toBeNull();
    expect(removeLink(db, link!.id)).toBe(true);
    expect(removeLink(db, link!.id)).toBe(false);
  });

  it("goes away with its bubble, as does an emptied shelf", () => {
    const { db, a, b, c } = fresh();
    const shelf = createShelf(db, "bread");
    moveThought(db, a.id, shelf.id, "bird");
    addLink(db, a.id, b.id, "bread");
    addLink(db, b.id, c.id, "family");
    expect(removeThought(db, a.id)).toBe(true);
    expect(removeThought(db, a.id)).toBe(false);
    expect(getThought(db, a.id)).toBeNull();
    expect(listLinks(db).map((l) => l.word)).toEqual(["family"]);
    expect(listClusters(db).some((x) => x.id === shelf.id)).toBe(false);
  });
});
