import { describe, expect, it } from "vitest";
import { ANGLES, anglesFor, buildMuseUser, parseMuse } from "@/lib/ai/muse";
import { applyTidy, buildTidyUser, hasWork, majorityLanguage, parseTidy, shelfName } from "@/lib/ai/tidy";
import { createDb } from "@/lib/db";
import { addLink, createBirdThought, createShelf, getLibrary, listClusters, listLinks, moveThought } from "@/lib/library";
import { createThought, getThought } from "@/lib/thoughts";

const setup = () => {
  const db = createDb(":memory:");
  const t = ["bake real bread", "my sourdough starter died", "call grandma", "grandma's garden", "quit sugar"].map((body) =>
    createThought(db, { body }),
  );
  return { db, t };
};

describe("tidy: what there is to do", () => {
  it("needs two loose bubbles, or one and a shelf", () => {
    const db = createDb(":memory:");
    expect(hasWork(getLibrary(db))).toBe(false);
    const a = createThought(db, { body: "one" });
    expect(hasWork(getLibrary(db))).toBe(false);
    createThought(db, { body: "two" });
    expect(hasWork(getLibrary(db))).toBe(true);
    const shelf = createShelf(db, "x");
    moveThought(db, a.id, shelf.id, "bird");
    expect(hasWork(getLibrary(db))).toBe(true);
  });

  it("shows the model shelves, loose bubbles, links and your own placements", () => {
    const { db, t } = setup();
    const shelf = createShelf(db, "bread");
    moveThought(db, t[0].id, shelf.id, "bird");
    moveThought(db, t[4].id, null, "you");
    addLink(db, t[2].id, t[3].id, "grandma");
    const text = buildTidyUser(getLibrary(db));
    expect(text).toContain(`<shelf id="${shelf.id}" name="bread">`);
    expect(text).toContain("my sourdough starter died");
    expect(text).toContain("kept_on_the_floor");
    expect(text).toContain(`${t[2].id} and ${t[3].id}: "grandma"`);
  });
});

describe("tidy: checking the model's plan", () => {
  it("keeps sensible moves, shelves and links", () => {
    const { db, t } = setup();
    const bread = createShelf(db, "bread");
    moveThought(db, t[0].id, bread.id, "bird");
    const plan = parseTidy(
      {
        new_shelves: [{ key: "new1", name: "  Grandma " }],
        moves: [
          { bubble: t[1].id, shelf: String(bread.id) },
          { bubble: t[2].id, shelf: "new1" },
          { bubble: t[3].id, shelf: "new1" },
        ],
        links: [{ a: t[4].id, b: t[1].id, word: "Food" }],
        line: '"two new shelves!"',
      },
      getLibrary(db),
    );
    expect(plan.moves).toEqual([{ bubble: t[1].id, shelf: bread.id }]);
    expect(plan.newShelves).toEqual([{ key: "new1", name: "grandma", bubbles: [t[2].id, t[3].id] }]);
    expect(plan.links).toEqual([{ a: t[1].id, b: t[4].id, word: "food" }]);
    expect(plan.line).toBe("two new shelves!");
  });

  it("drops anything that doesn't fit the library", () => {
    const { db, t } = setup();
    const bread = createShelf(db, "bread");
    moveThought(db, t[0].id, bread.id, "bird");
    moveThought(db, t[4].id, null, "you");
    addLink(db, t[2].id, t[3].id, "grandma");
    const bird = createBirdThought(db, "hm");
    const plan = parseTidy(
      {
        new_shelves: [
          { key: "lonely", name: "lonely" },
          { key: "vague", name: "misc" },
          { key: "dup", name: "Bread" },
        ],
        moves: [
          { bubble: t[0].id, shelf: "lonely" }, // already on a shelf
          { bubble: t[4].id, shelf: String(bread.id) }, // you put it on the floor
          { bubble: 999, shelf: String(bread.id) }, // no such bubble
          { bubble: t[1].id, shelf: "lonely" }, // a shelf of one
          { bubble: t[2].id, shelf: "77" }, // no such shelf
        ],
        links: [
          { a: t[2].id, b: t[3].id, word: "again" }, // already linked
          { a: t[1].id, b: t[1].id, word: "self" },
          { a: t[1].id, b: bird.id, word: "bird" },
          { a: t[1].id, b: t[2].id, word: "   " },
        ],
        line: "",
      },
      getLibrary(db),
    );
    expect(plan).toEqual({ newShelves: [], moves: [], links: [], line: null });
  });

  it("survives a sloppy answer", () => {
    const { db, t } = setup();
    const plan = parseTidy({ moves: [{ bubble: String(t[1].id), shelf: 3 }], line: "ok" }, getLibrary(db));
    expect(plan.newShelves).toEqual([]);
    expect(() => parseTidy({ line: 5 }, getLibrary(db))).toThrow();
  });
});

describe("tidy: names and links", () => {
  it("keeps shelf names short and whole", () => {
    expect(shelfName("Baking Projects and Bread Ideas")).toBe("baking projects");
    expect(shelfName("  grandma  ")).toBe("grandma");
    expect(shelfName("the")).toBe("the");
  });

  it("doesn't link bubbles that will share a shelf", () => {
    const { db, t } = setup();
    const plan = parseTidy(
      {
        new_shelves: [{ key: "n", name: "bread" }],
        moves: [{ bubble: t[0].id, shelf: "n" }, { bubble: t[1].id, shelf: "n" }],
        links: [
          { a: t[0].id, b: t[1].id, word: "bread" },
          { a: t[1].id, b: t[4].id, word: "food" },
        ],
        line: "",
      },
      getLibrary(db),
    );
    expect(plan.links.map((l) => l.word)).toEqual(["food"]);
  });
});

describe("tidy: doing it", () => {
  it("makes shelves, files bubbles and links them, in the order the bird acts it out", () => {
    const { db, t } = setup();
    const bread = createShelf(db, "bread");
    moveThought(db, t[0].id, bread.id, "bird");
    const result = applyTidy(db, {
      newShelves: [{ key: "new1", name: "grandma", bubbles: [t[2].id, t[3].id] }],
      moves: [{ bubble: t[1].id, shelf: bread.id }],
      links: [{ a: t[1].id, b: t[4].id, word: "food" }],
      line: "tidy!",
    });
    expect(result.steps.map((s) => s.kind)).toEqual(["shelf", "file", "file", "file", "link"]);
    const grandma = listClusters(db).find((c) => c.name === "grandma")!;
    expect(getThought(db, t[2].id)).toMatchObject({ clusterId: grandma.id, placedBy: "bird" });
    expect(getThought(db, t[1].id)?.clusterId).toBe(bread.id);
    expect(listLinks(db)).toHaveLength(1);
    expect(result.line).toBe("tidy!");
  });

  it("never moves a bubble you placed while the bird was thinking", () => {
    const { db, t } = setup();
    const plan = parseTidy(
      { new_shelves: [{ key: "n", name: "grandma" }], moves: [{ bubble: t[2].id, shelf: "n" }, { bubble: t[3].id, shelf: "n" }], links: [], line: "" },
      getLibrary(db),
    );
    moveThought(db, t[2].id, null, "you");
    moveThought(db, t[3].id, null, "you");
    const result = applyTidy(db, plan);
    expect(result.steps).toEqual([]);
    expect(listClusters(db).filter((c) => c.kind === "shelf")).toHaveLength(0);
    expect(getThought(db, t[2].id)?.placedBy).toBe("you");
  });
});

describe("languages", () => {
  it("finds the language most bubbles are in", () => {
    const db = createDb(":memory:");
    const he = ["שלום לכולם", "אני רוצה לאפות לחם"].map((body) => createThought(db, { body }));
    const en = createThought(db, { body: "hello" });
    expect(majorityLanguage([...he, en])).toBe("Hebrew");
    expect(majorityLanguage([en])).toBeNull();
  });
});

describe("the bird's own thoughts", () => {
  it("sees the whole library and its own shelf", () => {
    const { db, t } = setup();
    const shelf = createShelf(db, "bread");
    moveThought(db, t[0].id, shelf.id, "bird");
    const own = createBirdThought(db, "so much bread, so little eating");
    const text = buildMuseUser(getLibrary(db), [own], ["they bake when stressed"]);
    expect(text).toContain('<shelf name="bread" bubbles="1">');
    expect(text).toContain("so much bread, so little eating");
    expect(text).toContain("they bake when stressed");
    expect(text).toContain("call grandma");
  });

  it("looks at the library from an angle that fits it", () => {
    const { db, t } = setup();
    expect(anglesFor(getLibrary(db)).sort()).toEqual(["loose", "newest", "ready"]);
    const shelf = createShelf(db, "bread");
    moveThought(db, t[0].id, shelf.id, "bird");
    const other = createShelf(db, "grandma");
    moveThought(db, t[2].id, other.id, "bird");
    addLink(db, t[0].id, t[2].id, "care");
    expect(anglesFor(getLibrary(db)).sort()).toEqual(["biggest", "link", "loose", "newest", "pair", "quiet", "ready"]);
    expect(buildMuseUser(getLibrary(db), [], [], "link")).toContain(ANGLES.link);
  });

  it("rejects empty thoughts and repeats", () => {
    const { db } = setup();
    const own = createBirdThought(db, "three bubbles say start and none say finish");
    expect(parseMuse({ thought: '  "a new idea about grandma"  ' }, [own])).toEqual({ text: "a new idea about grandma" });
    expect(parseMuse({ thought: "the bird's thoughts: the sea keeps coming back" }, [own])).toEqual({ text: "the sea keeps coming back" });
    expect(parseMuse({ thought: "   " }, [own])).toHaveProperty("problem");
    expect(parseMuse({ thought: "three bubbles say start, none say finish!" }, [own])).toHaveProperty("problem");
  });
});
