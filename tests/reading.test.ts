import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { grounded, mentions, nameKey } from "@/lib/ai/ground";
import { buildReadUser, parseReading } from "@/lib/ai/read";
import { buildStepUser, parseStep, shelvesToSuggestFor } from "@/lib/ai/suggest";
import { getCards, saveCard, unread } from "@/lib/cards";
import { createDb } from "@/lib/db";
import { forgetFact, knowledgeText, learnFact, learnRule, listFacts, listRules } from "@/lib/knowledge";
import { createBirdThought, createShelf, getLibrary, moveThought, removeThought } from "@/lib/library";
import { addNote, recentNotes } from "@/lib/notebook";
import { MAX_OPEN_STEPS, addStep, closeStep, openSteps, recentSteps } from "@/lib/steps";
import { createThought } from "@/lib/thoughts";

const SPOKEN =
  "so the game we are making is called moon garden  it's a puzzle board game  my friend noa draws the cards  i really want to finish the first boss this week  honestly i'm scared someone will copy it";

describe("keeping the bird to what was said", () => {
  it("accepts quotes that really come from the text", () => {
    expect(grounded("i really want to finish the first boss", SPOKEN)).toBe(true);
    expect(grounded("I'm scared someone will copy it!", SPOKEN)).toBe(true);
    // Loosely quoted speech still counts when most of it is there, in order.
    expect(grounded("want to finish the first boss this weekend", SPOKEN)).toBe(true);
  });

  it("rejects quotes it made up, even from words that are all in the text", () => {
    expect(grounded("they feel invisible at work", SPOKEN)).toBe(false);
    expect(grounded("the game will copy my friend", SPOKEN)).toBe(false);
    expect(grounded("", SPOKEN)).toBe(false);
    expect(grounded("…", SPOKEN)).toBe(false);
  });

  it("finds a name however it was spaced", () => {
    expect(mentions("MoonGarden", SPOKEN)).toBe(true);
    expect(mentions("Noa", SPOKEN)).toBe(true);
    expect(mentions("Mira", SPOKEN)).toBe(false);
    expect(nameKey("Moon Garden")).toBe(nameKey("moongarden"));
  });
});

describe("reading a bubble", () => {
  const thought = { ...createThought(createDb(":memory:"), { body: SPOKEN, source: "spoken" }), id: 7 };

  it("gives the brain the whole bubble", () => {
    const long = { ...thought, body: `${"word ".repeat(600)}the very end` };
    expect(buildReadUser(long)).toContain("the very end");
    expect(buildReadUser({ ...thought, prompt: "what are you building?" })).toContain("what are you building?");
  });

  it("keeps names, stated feelings and plans, and drops the rest", () => {
    const reading = parseReading(
      {
        gist: "  They are making a board game called Moon Garden with Noa.  ",
        subjects: ["Moon Garden", "moongarden", "Noa", "game", "my friend", "Mira"],
        facts: [
          { name: "Moon Garden", what: "a puzzle board game" },
          { name: "friend", what: "draws the cards" },
          { name: "Etsy", what: "where it will be sold" },
        ],
        feelings: [
          { feeling: "scared of being copied", quote: "i'm scared someone will copy it" },
          { feeling: "afraid their work is invisible", quote: "nobody sees my work" },
        ],
        todos: [
          { todo: "finish the first boss", quote: "i really want to finish the first boss this week" },
          { todo: "start a devlog", quote: "i should start a devlog" },
        ],
        to_bird: { rule: "", quote: "" },
      },
      thought,
    );
    expect(reading.card).toEqual({
      thoughtId: 7,
      gist: "They are making a board game called Moon Garden with Noa.",
      subjects: ["moon garden", "noa"],
      feelings: ["scared of being copied"],
      todos: ["finish the first boss"],
    });
    expect(reading.facts).toEqual([{ name: "Moon Garden", what: "a puzzle board game" }]);
    expect(reading.rule).toBeNull();
  });

  it("hears an instruction to the bird, and doesn't hand it back as a to-do", () => {
    const told = { ...thought, body: "i work at saltworks on the night shift. i want you to keep moon garden apart from that" };
    const reading = parseReading(
      {
        gist: "They work at Saltworks and want Moon Garden kept apart.",
        subjects: ["saltworks"],
        facts: [],
        feelings: [],
        todos: [{ todo: "keep moon garden apart", quote: "keep moon garden apart from that" }],
        to_bird: { rule: "keep Moon Garden apart from Saltworks", quote: "i want you to keep moon garden apart from that" },
      },
      told,
    );
    expect(reading.rule).toBe("keep Moon Garden apart from Saltworks");
    expect(reading.card.todos).toEqual([]);
    // An "instruction" it can't show in the bubble is ignored.
    const made = parseReading({ gist: "x", to_bird: { rule: "sort by colour", quote: "please sort everything by colour" } }, told);
    expect(made.rule).toBeNull();
    expect(() => parseReading({ gist: "  " }, told)).toThrow();
  });
});

describe("what the bird knows", () => {
  it("keeps one fact per name, in your latest words, and your rules", () => {
    const db = createDb(":memory:");
    learnFact(db, "Moon Garden", "a board game", 1);
    learnFact(db, "moongarden", "a puzzle board game with Noa", 2);
    learnFact(db, "  ", "nothing", 3);
    learnRule(db, "keep Moon Garden apart from Saltworks", 4);
    learnRule(db, "Keep moon garden apart from saltworks", 5);
    expect(listFacts(db).map((f) => [f.name, f.body, f.thoughtId])).toEqual([
      ["Moon Garden", "a puzzle board game with Noa", 2],
    ]);
    expect(listRules(db)).toHaveLength(1);
    const text = knowledgeText(db);
    expect(text).toContain("- Moon Garden: a puzzle board game with Noa");
    expect(text).toContain("<the_person_told_you");
    expect(forgetFact(db, listRules(db)[0].id)).toBe(true);
    expect(knowledgeText(db)).not.toContain("the_person_told_you");
    expect(knowledgeText(createDb(":memory:"))).toContain("(nothing yet)");
  });

  it("forgets what a bubble taught it when the bubble goes", () => {
    const db = createDb(":memory:");
    const a = createThought(db, { body: "mira is from lisbon" });
    const b = createThought(db, { body: "something else" });
    createBirdThought(db, "a thought of my own");
    expect(unread(db).map((t) => t.id)).toEqual([a.id, b.id]);
    saveCard(db, { thoughtId: a.id, gist: "about mira", subjects: ["mira"], feelings: [], todos: ["write to mira"] });
    learnFact(db, "Mira", "from Lisbon", a.id);
    addStep(db, "write mira a message", a.id, null);
    expect(unread(db).map((t) => t.id)).toEqual([b.id]);
    expect(getCards(db).get(a.id)).toMatchObject({ gist: "about mira", todos: ["write to mira"], sorted: false });

    removeThought(db, a.id);
    expect(getCards(db).size).toBe(0);
    expect(listFacts(db)).toEqual([]);
    expect(openSteps(db)).toEqual([]);
  });

  it("starts over from the old notebook of guesses", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mybrary-")), "mind.db");
    const old = createDb(file);
    old.prepare("INSERT INTO notes (kind, body) VALUES ('note', 'they fear their work is invisible')").run();
    old.pragma("user_version = 0");
    old.close();
    const db = createDb(file);
    expect(recentNotes(db, "note", 5)).toEqual([]);
    // Only once: what the bird says from now on stays.
    addNote(db, "said", "hello there");
    db.close();
    const again = createDb(file);
    expect(recentNotes(again, "said", 5)).toHaveLength(1);
    again.close();
  });
});

describe("small steps", () => {
  const setup = () => {
    const db = createDb(":memory:");
    const a = createThought(db, { body: "finish the first boss of moon garden" });
    const b = createThought(db, { body: "mira wants to meet at the spring fair" });
    // An empty shelf disappears, so each one gets its bubble right away.
    const game = createShelf(db, "moon garden");
    moveThought(db, a.id, game.id, "bird");
    const love = createShelf(db, "mira");
    moveThought(db, b.id, love.id, "bird");
    saveCard(db, { thoughtId: a.id, gist: "the first boss", subjects: [], feelings: ["excited"], todos: ["finish the first boss"] });
    saveCard(db, { thoughtId: b.id, gist: "meeting mira", subjects: ["mira"], feelings: [], todos: [] });
    return { db, a, b, game, love };
  };

  it("opens, closes once, and remembers", () => {
    const { db, a, game } = setup();
    const step = addStep(db, "  sketch   the first boss. ", a.id, game.id);
    expect(step).toMatchObject({ body: "sketch the first boss.", status: "open", clusterId: game.id });
    expect(getLibrary(db).steps).toHaveLength(1);
    expect(closeStep(db, step.id, "done")?.status).toBe("done");
    expect(closeStep(db, step.id, "dismissed")).toBeNull();
    expect(openSteps(db)).toEqual([]);
    expect(recentSteps(db, 5).map((s) => s.status)).toEqual(["done"]);
    expect(() => addStep(db, "   ", a.id, null)).toThrow();
  });

  it("suggests for shelves it has read and hasn't just spoken about", () => {
    const { db, a, game, love } = setup();
    const ids = () => shelvesToSuggestFor(getLibrary(db), getCards(db), recentSteps(db, 12)).map((c) => c.id);
    expect(ids()).toEqual([game.id, love.id]);
    const step = addStep(db, "sketch the first boss", a.id, game.id);
    expect(ids()).toEqual([love.id]);
    // Done a moment ago: the shelf still rests.
    closeStep(db, step.id, "done");
    expect(ids()).toEqual([love.id]);
    const later = Date.now() + 13 * 60 * 60 * 1000;
    expect(shelvesToSuggestFor(getLibrary(db), getCards(db), recentSteps(db, 12), later).map((c) => c.id)).toEqual([game.id, love.id]);
    for (let i = 0; i < MAX_OPEN_STEPS; i++) addStep(db, `step number ${i}`, a.id, null);
    expect(ids()).toEqual([]);
  });

  it("builds the step from what they said they want, and refuses repeats and scraps", () => {
    const { db, a, game } = setup();
    const lib = getLibrary(db);
    const members = lib.thoughts.filter((t) => t.clusterId === game.id);
    const past = [addStep(db, "sketch the first boss on paper", a.id, game.id)];
    const text = buildStepUser(game, members, getCards(db), "", past);
    expect(text).toContain('<shelf name="moon garden">');
    expect(text).toContain("they said they want to: finish the first boss");
    expect(text).toContain("they said they feel: excited");
    expect(text).toContain("- sketch the first boss on paper (still waiting)");

    expect(parseStep({ bubble: a.id, step: ' "List the three attacks the first boss needs." ' }, members, past)).toEqual({
      body: "List the three attacks the first boss needs",
      thoughtId: a.id,
    });
    expect(parseStep({ bubble: 999, step: "name the boss today" }, members, past)?.thoughtId).toBe(a.id);
    expect(parseStep({ bubble: a.id, step: "" }, members, past)).toBeNull();
    expect(parseStep({ bubble: a.id, step: "think about how the boss should feel" }, members, past)).toBeNull();
    expect(parseStep({ bubble: a.id, step: "sketch the first boss on some paper" }, members, past)).toBeNull();
  });
});
