import { describe, expect, it } from "vitest";
import { FADED_AFTER_DAYS, OLD_AFTER_DAYS, agedLine, fadedness, nextAged } from "@/lib/aging";
import { buildAskUser, parseAnswer, relevant } from "@/lib/ai/ask";
import { buildAboutUser, parseAbout, shelfToDescribe } from "@/lib/ai/shelves";
import { buildPlaceUser, linkCandidates, parseGroups, parseLinkProof, parseReason } from "@/lib/ai/tidy";
import { getCards, saveCard } from "@/lib/cards";
import { findBubbles, snippet } from "@/lib/find";
import { createDb, type DB } from "@/lib/db";
import { editFact, learnFact, learnRule, listFacts, listRules } from "@/lib/knowledge";
import {
  addLink,
  createShelf,
  describeShelf,
  getCluster,
  getLibrary,
  listLinks,
  moveThought,
  poppedPairs,
  removeLink,
  removeThought,
  updateShelf,
} from "@/lib/library";
import { nextPattern, patternLine, patterns } from "@/lib/patterns";
import { addStep, closeStep, openSteps, snoozeStep } from "@/lib/steps";
import { createThought, getThought, listThoughts, type Thought } from "@/lib/thoughts";

const DAY = 24 * 60 * 60 * 1000;

/** A bubble with its card, as if the bird had read it. */
function bubble(db: DB, body: string, subjects: string[] = [], daysAgo = 0, now = Date.now()): Thought {
  const t = createThought(db, { body });
  if (daysAgo) db.prepare("UPDATE thoughts SET created_at = ? WHERE id = ?").run(new Date(now - daysAgo * DAY).toISOString(), t.id);
  saveCard(db, { thoughtId: t.id, gist: `they wrote: ${body}`, subjects, feelings: [], todos: [] });
  return getThought(db, t.id) as Thought;
}

describe("asking the bird", () => {
  const setup = () => {
    const db = createDb(":memory:");
    const a = bubble(db, "moon garden needs a second boss before the demo in june", ["moon garden"]);
    const b = bubble(db, "noa said the card art will be ready on friday", ["noa"]);
    const c = bubble(db, "i want to bake sourdough for the neighbours");
    return { db, a, b, c, all: listThoughts(db), cards: getCards(db) };
  };

  it("reads the bubbles that share the question's own words first", () => {
    const { a, b, all, cards } = setup();
    expect(relevant("when is the moon garden demo?", all, cards).map((t) => t.id)).toEqual([a.id]);
    expect(relevant("what did noa say about the art?", all, cards)[0].id).toBe(b.id);
    expect(relevant("what is it?", all, cards)).toEqual([]);
  });

  it("shows the brain the question, the close bubbles in full and the rest in short", () => {
    const { a, c, all, cards } = setup();
    const user = buildAskUser("when is the moon garden demo?", all, cards, "<what_you_know>\n(nothing yet)\n</what_you_know>");
    expect(user).toContain(`<bubble id="${a.id}"`);
    expect(user).toContain("needs a second boss before the demo in june");
    expect(user).toContain(`they wrote: ${c.body}`);
    expect(user).toContain("<their_question>when is the moon garden demo?</their_question>");
  });

  it("keeps an answer only when it points at words that are really in a bubble", () => {
    const { a, b, all, cards } = setup();
    const good = { found: [{ bubble: a.id, quote: "before the demo in june" }], answer: "the demo is in june." };
    expect(parseAnswer(good, all, cards)).toEqual({ answer: "the demo is in june.", ids: [a.id] });
    // Made-up proof, a bubble that doesn't exist, or no proof at all: the bird says nothing.
    const invented = { found: [{ bubble: b.id, quote: "the demo is in march at the fair" }], answer: "the demo is in march." };
    expect(parseAnswer(invented, all, cards)).toEqual({ answer: null, ids: [] });
    expect(parseAnswer({ found: [{ bubble: 999, quote: "before the demo in june" }], answer: "june." }, all, cards).answer).toBeNull();
    expect(parseAnswer({ found: [], answer: "probably june" }, all, cards).answer).toBeNull();
    expect(parseAnswer({ found: good.found, answer: "" }, all, cards).answer).toBeNull();
  });
});

describe("why the bird did it", () => {
  it("keeps its reason for a shelf, and drops it when you move the bubble yourself", () => {
    const db = createDb(":memory:");
    const t = bubble(db, "moon garden needs a second boss");
    const shelf = createShelf(db, "moon garden");
    expect(parseReason({ reason: "  it is about the moon garden game,   like this shelf ", shelf: "1" })).toBe(
      "it is about the moon garden game, like this shelf",
    );
    expect(parseReason({ shelf: "1" })).toBeNull();
    db.prepare("UPDATE thoughts SET cluster_id = ?, placed_by = 'bird', why = 'it is about the game' WHERE id = ?").run(shelf.id, t.id);
    expect(getThought(db, t.id)?.why).toBe("it is about the game");
    const other = createShelf(db, "other");
    expect(moveThought(db, t.id, other.id, "you").why).toBeNull();
  });

  it("keeps the words that prove a link, the right way round", () => {
    const db = createDb(":memory:");
    const a = bubble(db, "call grandma on sunday about the trip");
    const b = bubble(db, "grandma's garden needs weeding before autumn");
    const proof = parseLinkProof(
      { reason: "", connected: true, word: "grandma", quote_a: "call grandma on sunday", quote_b: "grandma's garden needs weeding" },
      { a, b, shared: "grandma" },
    );
    expect(proof).toEqual({ word: "grandma", quotes: ["call grandma on sunday", "grandma's garden needs weeding"] });
    // Given the other way round, each quote still ends up with its own bubble.
    const link = addLink(db, b.id, a.id, "grandma", ["grandma's garden needs weeding", "call grandma on sunday"]);
    expect(link?.a).toBe(a.id);
    expect(link?.quotes).toEqual(["call grandma on sunday", "grandma's garden needs weeding"]);
    expect(addLink(db, a.id, bubble(db, "x y z").id, "plain")?.quotes).toBeNull();
  });
});

describe("links you popped", () => {
  it("are never drawn again, until one of the bubbles is gone", () => {
    const db = createDb(":memory:");
    const a = bubble(db, "call grandma on sunday", ["grandma"]);
    const b = bubble(db, "grandma's garden needs weeding", ["grandma"]);
    const link = addLink(db, a.id, b.id, "grandma");
    expect(linkCandidates(getLibrary(db), getCards(db), [], poppedPairs(db))).toEqual([]);
    expect(removeLink(db, link!.id)).toBe(true);
    expect(listLinks(db)).toEqual([]);
    expect(poppedPairs(db)).toEqual(new Set([`${a.id}-${b.id}`]));
    // Without the memory the bird would offer the pair again; with it, never.
    expect(linkCandidates(getLibrary(db), getCards(db), [])).toHaveLength(1);
    expect(linkCandidates(getLibrary(db), getCards(db), [], poppedPairs(db))).toEqual([]);
    expect(addLink(db, b.id, a.id, "grandma")).toBeNull();
    removeThought(db, b.id);
    expect(poppedPairs(db).size).toBe(0);
  });
});

describe("what belongs on a shelf", () => {
  const setup = () => {
    const db = createDb(":memory:");
    const a = bubble(db, "moon garden needs a second boss");
    const b = bubble(db, "the moon garden cards are too small");
    const shelf = createShelf(db, "moon garden");
    moveThought(db, a.id, shelf.id, "bird");
    moveThought(db, b.id, shelf.id, "bird");
    return { db, a, b, shelf };
  };

  it("is written by the bird once it has read the shelf, and again when bubbles come or go", () => {
    const { db, shelf } = setup();
    expect(shelfToDescribe(db)?.id).toBe(shelf.id);
    expect(describeShelf(db, shelf.id, "  bubbles about the moon garden   board game ", 2)).toBe(true);
    expect(getCluster(db, shelf.id)).toMatchObject({ about: "bubbles about the moon garden board game", aboutBy: "bird" });
    expect(shelfToDescribe(db)).toBeNull();
    const c = bubble(db, "print the moon garden rulebook");
    moveThought(db, c.id, shelf.id, "you");
    expect(shelfToDescribe(db)?.id).toBe(shelf.id);
  });

  it("stays yours once you write it, and goes back to the bird when you clear it", () => {
    const { db, shelf } = setup();
    describeShelf(db, shelf.id, "bubbles about the moon garden board game", 2);
    expect(updateShelf(db, shelf.id, { about: " only the board game,  not the garden " })).toMatchObject({
      about: "only the board game, not the garden",
      aboutBy: "you",
    });
    expect(describeShelf(db, shelf.id, "the bird tries again", 2)).toBe(false);
    expect(shelfToDescribe(db)).toBeNull();
    // Renaming doesn't touch your words.
    expect(updateShelf(db, shelf.id, { name: "the game" })?.about).toBe("only the board game, not the garden");
    expect(updateShelf(db, shelf.id, { about: "" })).toMatchObject({ about: null, aboutBy: null });
    expect(shelfToDescribe(db)?.id).toBe(shelf.id);
  });

  it("drops the bird's line when you rename the shelf", () => {
    const { db, shelf } = setup();
    describeShelf(db, shelf.id, "bubbles about the moon garden board game", 2);
    expect(updateShelf(db, shelf.id, { name: "saltworks" })?.about).toBeNull();
    expect(updateShelf(db, shelf.id, { color: "mint" })?.name).toBe("saltworks");
  });

  it("is shown to the brain when it sorts, and asked for from the shelf's bubbles", () => {
    const { db, shelf } = setup();
    updateShelf(db, shelf.id, { about: "only the board game" });
    const loose = bubble(db, "a new boss idea");
    const lib = getLibrary(db);
    expect(buildPlaceUser(lib, getCards(db), "", loose)).toContain("holds: only the board game (the person wrote this)");
    const members = lib.thoughts.filter((t) => t.clusterId === shelf.id);
    const user = buildAboutUser(getCluster(db, shelf.id)!, members, getCards(db));
    expect(user).toContain('<shelf name="moon garden">');
    expect(user).toContain("- they wrote: moon garden needs a second boss");
    expect(parseAbout({ holds: '"bubbles about the moon garden board game"' })).toBe("bubbles about the moon garden board game");
    expect(parseAbout({ holds: "games" })).toBeNull();
  });

  it("comes with a new shelf when the bird makes one", () => {
    const db = createDb(":memory:");
    const a = bubble(db, "book the lisbon flights");
    const b = bubble(db, "find a flat in lisbon for may");
    const [g] = parseGroups(
      { shelves: [{ reason: "both plan the lisbon trip", name: "lisbon trip", holds: "plans for the trip to lisbon", bubbles: [a.id, b.id] }] },
      getLibrary(db),
      listThoughts(db),
    );
    expect(g).toEqual({ name: "lisbon trip", bubbles: [a.id, b.id], reason: "both plan the lisbon trip", holds: "plans for the trip to lisbon" });
  });
});

describe("correcting what the bird knows", () => {
  it("changes a fact or a rule in place and makes it yours", () => {
    const db = createDb(":memory:");
    const t = bubble(db, "mira is my cousin who draws");
    learnFact(db, "Mira", "their cousin", t.id);
    learnRule(db, "keep saltworks apart from moon garden", t.id);
    const fact = listFacts(db)[0];
    expect(editFact(db, fact.id, "  my sister,   not my cousin ")).toMatchObject({ name: "Mira", body: "my sister, not my cousin", thoughtId: null });
    expect(editFact(db, listRules(db)[0].id, "never mix saltworks with moon garden")?.body).toBe("never mix saltworks with moon garden");
    expect(editFact(db, fact.id, "   ")).toBeNull();
    expect(editFact(db, 999, "nothing")).toBeNull();
    // Yours now: popping the bubble it came from doesn't take the correction away.
    removeThought(db, t.id);
    expect(listFacts(db).map((f) => f.body)).toEqual(["my sister, not my cousin"]);
  });
});

describe("what keeps coming back", () => {
  it("counts the bubbles of the last month that name the same thing", () => {
    const db = createDb(":memory:");
    const now = new Date("2026-11-15T12:00:00Z");
    const ids = [
      bubble(db, "saltworks pitch is on monday", ["Saltworks"], 20, now.getTime()),
      bubble(db, "the salt works logo looks off", ["salt works"], 9, now.getTime()),
      bubble(db, "saltworks again in my head", ["saltworks", "Saltworks"], 1, now.getTime()),
    ].map((t) => t.id);
    bubble(db, "saltworks, long ago", ["saltworks"], 60, now.getTime());
    bubble(db, "noa called", ["noa"], 2, now.getTime());
    expect(patterns(db, now)).toEqual([{ name: "Saltworks", count: 3, ids }]);
    expect(patternLine({ name: "Saltworks", count: 3, ids })).toBe('"Saltworks" again. that\'s the third bubble this month that mentions it.');
  });

  it("is said once, and again only when it comes back once more", () => {
    const db = createDb(":memory:");
    const now = new Date("2026-11-15T12:00:00Z");
    for (const d of [5, 3, 1]) bubble(db, "saltworks keeps me up", ["saltworks"], d, now.getTime());
    expect(nextPattern(db, now)?.count).toBe(3);
    expect(nextPattern(db, now)).toBeNull();
    bubble(db, "saltworks, yet again", ["saltworks"], 0, now.getTime());
    expect(nextPattern(db, now)?.line).toContain("fourth bubble");
    expect(nextPattern(db, now)).toBeNull();
  });
});

describe("steps for later", () => {
  it("leave the note and come back when their time is up", () => {
    const db = createDb(":memory:");
    const t = bubble(db, "i need to email noa about the art");
    const step = addStep(db, "email noa about the card art", t.id, null);
    const now = new Date("2026-11-15T12:00:00Z");
    expect(snoozeStep(db, step.id, now)?.snoozeUntil).toBe("2026-11-18T12:00:00.000Z");
    expect(openSteps(db, now)).toEqual([]);
    expect(openSteps(db, new Date("2026-11-18T11:00:00Z"))).toEqual([]);
    expect(openSteps(db, new Date("2026-11-18T12:00:01Z")).map((s) => s.id)).toEqual([step.id]);
    closeStep(db, step.id, "done");
    expect(snoozeStep(db, step.id, now)).toBeNull();
  });
});

describe("finding a bubble", () => {
  it("matches the words you type, newest first, and shows them in place", () => {
    const db = createDb(":memory:");
    const a = bubble(db, "the Lisbon flat has a tiny balcony with a view of the river and the bridge");
    const b = bubble(db, "book lisbon flights");
    bubble(db, "sourdough at 6am");
    const all = listThoughts(db);
    expect(findBubbles(all, " lisb ").map((t) => t.id)).toEqual([b.id, a.id]);
    expect(findBubbles(all, "l")).toEqual([]);
    expect(findBubbles(all, "zebra")).toEqual([]);
    expect(snippet(a.body, "river")).toBe("…balcony with a view of the river and the bridge");
    expect(snippet("short one", "short")).toBe("short one");
  });
});

describe("old bubbles", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("fade slowly once they are old enough", () => {
    const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
    expect(fadedness(at(3), now.getTime())).toBe(0);
    expect(fadedness(at(OLD_AFTER_DAYS), now.getTime())).toBe(0);
    expect(fadedness(at((OLD_AFTER_DAYS + FADED_AFTER_DAYS) / 2), now.getTime())).toBeCloseTo(0.5, 2);
    expect(fadedness(at(900), now.getTime())).toBe(1);
    expect(fadedness("not a date", now.getTime())).toBe(0);
  });

  it("get asked about once, oldest first, and then left alone for a good while", () => {
    const db = createDb(":memory:");
    const old = bubble(db, "i will run every morning", [], 200, now.getTime());
    const older = bubble(db, "quit sugar this year", [], 100, now.getTime());
    bubble(db, "fresh thought", [], 2, now.getTime());
    const first = nextAged(db, now);
    expect(first?.thought.id).toBe(old.id);
    expect(first?.line).toBe("*blows the dust off* this one is from april. still true?");
    expect(nextAged(db, now)?.thought.id).toBe(older.id);
    expect(nextAged(db, now)).toBeNull();
    // Much later, it may ask again.
    expect(nextAged(db, new Date(now.getTime() + 120 * DAY))?.thought.id).toBe(old.id);
    expect(agedLine("2025-03-02T10:00:00Z", now)).toContain("march 2025");
  });
});
