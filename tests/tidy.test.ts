import { beforeEach, describe, expect, it, vi } from "vitest";

const brain = vi.hoisted(() => ({ answers: [] as unknown[], asked: [] as string[] }));
vi.mock("@/lib/ai/llm", () => ({
  askJson: async (req: { user: string }) => {
    brain.asked.push(req.user);
    if (brain.answers.length === 0) throw new Error("the test brain has nothing more to say");
    return { value: brain.answers.shift(), provider: "ollama" };
  },
}));

import { ANGLES, anglesFor, buildMuseUser, parseMuse } from "@/lib/ai/muse";
import {
  buildGroupUser,
  buildPlaceUser,
  hasWork,
  linkCandidates,
  majorityLanguage,
  parseGroups,
  parseLink,
  parsePlace,
  shelfName,
  tidy,
} from "@/lib/ai/tidy";
import { getCards, saveCard } from "@/lib/cards";
import { createDb, type DB } from "@/lib/db";
import { knowledgeText, learnFact, learnRule } from "@/lib/knowledge";
import { addLink, createBirdThought, createShelf, getLibrary, listClusters, listLinks, moveThought } from "@/lib/library";
import { createThought, getThought, type Thought } from "@/lib/thoughts";

const BODIES = [
  "bake real bread this weekend",
  "my sourdough starter died",
  "call grandma on sunday",
  "grandma's garden needs weeding",
  "quit sugar",
];

/** Gives a bubble a card, as if the bird had read it. */
const read = (db: DB, t: Thought, subjects: string[] = [], todos: string[] = []) =>
  saveCard(db, { thoughtId: t.id, gist: `about: ${t.body}`, subjects, feelings: [], todos });

const setup = () => {
  const db = createDb(":memory:");
  const t = BODIES.map((body) => createThought(db, { body }));
  for (const x of t) read(db, x);
  return { db, t };
};

beforeEach(() => {
  brain.answers = [];
  brain.asked = [];
  // The bird remembers what it already tried between tidies: each test starts with a clear head.
  const memo = globalThis as { __birdLinkTried?: unknown; __birdLooseSeen?: unknown };
  delete memo.__birdLinkTried;
  delete memo.__birdLooseSeen;
});

describe("tidy: what there is to do", () => {
  it("needs two loose bubbles, one and a shelf, or a bubble to look at again", () => {
    const db = createDb(":memory:");
    expect(hasWork(db, getLibrary(db))).toBe(false);
    const a = createThought(db, { body: "one" });
    expect(hasWork(db, getLibrary(db))).toBe(false);
    const b = createThought(db, { body: "two" });
    expect(hasWork(db, getLibrary(db))).toBe(true);
    const shelf = createShelf(db, "x");
    moveThought(db, a.id, shelf.id, "bird");
    moveThought(db, b.id, shelf.id, "bird");
    expect(hasWork(db, getLibrary(db))).toBe(false);
    // The bird filed it before reading it: once it has a card, it's worth a second look.
    read(db, a);
    expect(getLibrary(db).review).toBe(1);
    expect(hasWork(db, getLibrary(db))).toBe(true);
  });
});

describe("tidy: one bubble at a time", () => {
  it("shows the shelves as summaries, what the bird knows, and the whole bubble", () => {
    const { db, t } = setup();
    const bread = createShelf(db, "bread");
    moveThought(db, t[0].id, bread.id, "you");
    learnFact(db, "Grandma", "lives by the sea", t[2].id);
    learnRule(db, "keep baking apart from dieting", t[4].id);
    const lib = getLibrary(db);
    const text = buildPlaceUser(lib, getCards(db), knowledgeText(db), lib.thoughts[1]);
    expect(text).toContain(`<shelf id="${bread.id}" name="bread">`);
    expect(text).toContain("about: bake real bread this weekend (placed here by the person)");
    expect(text).toContain("Grandma: lives by the sea");
    expect(text).toContain("keep baking apart from dieting");
    expect(text).toContain("in full: my sourdough starter died");
    expect(text).not.toContain("Right now this bubble sits on");
    // A bubble being looked at again isn't listed as its own neighbour.
    const again = buildPlaceUser(lib, getCards(db), "", lib.thoughts[0]);
    expect(again).toContain('Right now this bubble sits on "bread"');
    expect(again).toContain("(nothing else on it)");
  });

  it("only accepts a shelf that exists", () => {
    const { db } = setup();
    const bread = createShelf(db, "bread");
    const lib = getLibrary(db);
    expect(parsePlace({ reason: "it's about bread", shelf: String(bread.id) }, lib)).toBe(bread.id);
    expect(parsePlace({ reason: "", shelf: bread.id }, lib)).toBe(bread.id);
    expect(parsePlace({ reason: "nothing fits", shelf: "none" }, lib)).toBeNull();
    expect(parsePlace({ reason: "", shelf: "99" }, lib)).toBeNull();
    expect(() => parsePlace({ reason: "" }, lib)).toThrow();
  });
});

describe("tidy: new shelves", () => {
  it("keeps short real names with at least two loose bubbles", () => {
    const { db, t } = setup();
    createShelf(db, "bread");
    const lib = getLibrary(db);
    const groups = parseGroups(
      {
        shelves: [
          { name: "  Grandma Things And ", bubbles: [t[2].id, t[3].id, t[3].id, 999] },
          { name: "misc", bubbles: [t[0].id, t[1].id] },
          { name: "Bread", bubbles: [t[0].id, t[1].id] },
          { name: "lonely", bubbles: [t[4].id] },
          { name: "again", bubbles: [t[2].id, t[4].id] },
        ],
      },
      lib,
      lib.thoughts,
    );
    expect(groups).toEqual([{ name: "grandma things", bubbles: [t[2].id, t[3].id] }]);
    expect(buildGroupUser(lib, getCards(db), "", lib.thoughts)).toContain(`<bubble id="${t[4].id}">about: quit sugar</bubble>`);
  });

  it("keeps shelf names short and whole", () => {
    expect(shelfName("Baking Projects and Bread Ideas")).toBe("baking projects");
    expect(shelfName("  grandma  ")).toBe("grandma");
    expect(shelfName("the")).toBe("the");
  });
});

describe("tidy: links", () => {
  it("only suggests pairs on different shelves that name the same thing", () => {
    const { db, t } = setup();
    const lib = getLibrary(db);
    const pairs = linkCandidates(lib, getCards(db), ["Grandma"]);
    expect(pairs.map((p) => [p.a.id, p.b.id, p.shared])).toEqual([[t[2].id, t[3].id, "Grandma"]]);

    // Already linked, already tried, or sitting together: nothing to ask.
    expect(linkCandidates(lib, getCards(db), ["Grandma"], new Set([`${t[2].id}-${t[3].id}`]))).toEqual([]);
    const shelf = createShelf(db, "grandma");
    moveThought(db, t[2].id, shelf.id, "bird");
    moveThought(db, t[3].id, shelf.id, "bird");
    expect(linkCandidates(getLibrary(db), getCards(db), ["Grandma"])).toEqual([]);
  });

  it("finds names from the bubbles' cards too", () => {
    const { db, t } = setup();
    read(db, t[0], ["bread"]);
    const pairs = linkCandidates(getLibrary(db), getCards(db), []);
    expect(pairs).toEqual([]); // only one bubble says "bread"
    read(db, t[1], ["sourdough"]);
    const more = createThought(db, { body: "sourdough for the neighbours" });
    read(db, more);
    expect(linkCandidates(getLibrary(db), getCards(db), []).map((p) => p.shared)).toEqual(["sourdough"]);
  });

  it("needs the connection shown in both bubbles' own words", () => {
    const { db, t } = setup();
    const lib = getLibrary(db);
    const c = { a: lib.thoughts[2], b: lib.thoughts[3], shared: "grandma" };
    const good = { reason: "", connected: true, word: "Grandma  Time now", quote_a: "call grandma on sunday", quote_b: "grandma's garden needs weeding" };
    expect(parseLink(good, c)).toBe("grandma time");
    expect(parseLink({ ...good, connected: false }, c)).toBeNull();
    expect(parseLink({ ...good, word: " " }, c)).toBeNull();
    expect(parseLink({ ...good, quote_b: "she misses her garden terribly" }, c)).toBeNull();
    expect(t).toHaveLength(5);
  });
});

describe("tidy: doing it", () => {
  it("looks again at a bubble it misfiled, then shelves, groups and links the rest", async () => {
    const { db, t } = setup();
    learnFact(db, "Grandma", "lives by the sea", t[2].id);
    const bread = createShelf(db, "bread");
    moveThought(db, t[0].id, bread.id, "you");
    const sweets = createShelf(db, "sweets");
    moveThought(db, t[1].id, sweets.id, "bird"); // wrong: the starter is about bread
    moveThought(db, t[4].id, sweets.id, "you");

    brain.answers = [
      { reason: "the starter is for bread", shelf: String(bread.id) }, // review of t[1]
      { reason: "grandma, not bread", shelf: "none" }, // t[2]
      { reason: "grandma, not bread", shelf: "none" }, // t[3]
      { shelves: [{ reason: "both about grandma", name: "grandma", bubbles: [t[2].id, t[3].id] }] },
    ];
    const result = await tidy(db);

    const grandma = listClusters(db).find((c) => c.name === "grandma")!;
    expect(result.steps).toEqual([
      { kind: "file", thoughtId: t[1].id, clusterId: bread.id, from: sweets.id },
      { kind: "shelf", cluster: grandma },
      { kind: "file", thoughtId: t[2].id, clusterId: grandma.id, from: null },
      { kind: "file", thoughtId: t[3].id, clusterId: grandma.id, from: null },
    ]);
    expect(getThought(db, t[1].id)).toMatchObject({ clusterId: bread.id, placedBy: "bird" });
    expect(getThought(db, t[4].id)).toMatchObject({ clusterId: sweets.id, placedBy: "you" });
    expect(result.line).toBe('a new shelf: "grandma"');
    expect(getLibrary(db).review).toBe(0);
    // The two grandma bubbles ended up together, so there was no link left to ask about.
    expect(brain.answers).toEqual([]);
    expect(listLinks(db)).toEqual([]);
  });

  it("takes a bubble down when it fits no shelf, and removes the shelf it leaves empty", async () => {
    const { db, t } = setup();
    const bread = createShelf(db, "bread");
    moveThought(db, t[4].id, bread.id, "bird");
    for (const x of [t[0], t[1], t[2], t[3]]) moveThought(db, x.id, null, "you");
    brain.answers = [{ reason: "sugar isn't bread", shelf: "none" }];
    const result = await tidy(db);
    expect(result.steps).toEqual([{ kind: "file", thoughtId: t[4].id, clusterId: null, from: bread.id }]);
    expect(getThought(db, t[4].id)).toMatchObject({ clusterId: null, placedBy: null });
    expect(listClusters(db).filter((c) => c.kind === "shelf")).toEqual([]);
    expect(result.line).toContain("didn't belong");
  });

  it("never moves a bubble you placed while the bird was thinking", async () => {
    const { db, t } = setup();
    const bread = createShelf(db, "bread");
    moveThought(db, t[0].id, bread.id, "you");
    for (const x of [t[2], t[3], t[4]]) moveThought(db, x.id, null, "you");
    // You drop the loose bubble on the floor yourself just as the bird decides.
    brain.answers = [{ reason: "bread", shelf: String(bread.id) }];
    const original = db.prepare.bind(db);
    let moved = false;
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (!moved && sql.includes("UPDATE thoughts SET cluster_id = ?, placed_by = ?")) {
        moved = true;
        original("UPDATE thoughts SET placed_by = 'you' WHERE id = ?").run(t[1].id);
      }
      return original(sql);
    });
    const result = await tidy(db);
    expect(result.steps).toEqual([]);
    expect(getThought(db, t[1].id)).toMatchObject({ clusterId: null, placedBy: "you" });
  });

  it("links two bubbles that share a name, and doesn't ask about the same pair twice", async () => {
    const { db, t } = setup();
    learnFact(db, "Grandma", "lives by the sea", t[2].id);
    for (const x of t) moveThought(db, x.id, null, "you");
    brain.answers = [
      { reason: "both grandma", connected: true, word: "grandma", quote_a: "call grandma on sunday", quote_b: "grandma's garden needs weeding" },
    ];
    const result = await tidy(db);
    expect(result.steps.map((s) => s.kind)).toEqual(["link"]);
    expect(listLinks(db).map((l) => l.word)).toEqual(["grandma"]);
    expect(result.line).toBe('those two share "grandma"');
    expect((await tidy(db)).steps).toEqual([]);
    expect(brain.asked).toHaveLength(1);
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
  it("sees the whole library as summaries, what it knows, and its own shelf", () => {
    const { db, t } = setup();
    const shelf = createShelf(db, "bread");
    moveThought(db, t[0].id, shelf.id, "bird");
    read(db, t[0], [], ["buy flour"]);
    learnFact(db, "Grandma", "lives by the sea", t[2].id);
    const own = createBirdThought(db, "so much bread, so little eating");
    const text = buildMuseUser(getLibrary(db), [own], getCards(db), knowledgeText(db));
    expect(text).toContain('<shelf name="bread" bubbles="1">');
    expect(text).toContain("- about: bake real bread this weekend [they want to: buy flour]");
    expect(text).toContain("so much bread, so little eating");
    expect(text).toContain("Grandma: lives by the sea");
    expect(text).toContain("about: call grandma on sunday");
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
    expect(buildMuseUser(getLibrary(db), [], getCards(db), "", "link")).toContain(ANGLES.link);
  });

  it("rejects scraps and repeats", () => {
    const { db } = setup();
    const own = createBirdThought(db, "three bubbles say start and none say finish");
    expect(parseMuse({ thought: '  "a new idea about grandma and her garden"  ' }, [own])).toEqual({
      text: "a new idea about grandma and her garden",
    });
    expect(parseMuse({ thought: "the bird's thoughts: the sea keeps coming back to them" }, [own])).toEqual({
      text: "the sea keeps coming back to them",
    });
    expect(parseMuse({ thought: "   " }, [own])).toHaveProperty("problem");
    expect(parseMuse({ thought: "#work - saltworks" }, [own])).toHaveProperty("problem");
    expect(parseMuse({ thought: "three bubbles say start, none say finish! not one" }, [own])).toHaveProperty("problem");
  });
});
