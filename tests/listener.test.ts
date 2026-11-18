import { describe, expect, it } from "vitest";
import { buildDigestUser, needsDigest, parseDigest } from "@/lib/ai/digest";
import { buildReflectUser, parseReflection, problemWithQuestion, type ReflectInput } from "@/lib/ai/reflect";
import { POKED, QUIET, SETTLED, STEP_NOPE, greeting } from "@/lib/bird/lines";
import { saveCard } from "@/lib/cards";
import { createDb } from "@/lib/db";
import { createBirdThought, createShelf, getLibrary, moveThought } from "@/lib/library";
import { recentNotes } from "@/lib/notebook";
import { PAGE_LINES_MAX, answerStep, floating, getPage, savePage, settle, unsettled, worldView } from "@/lib/page";
import { createThought, listThoughts, type Thought } from "@/lib/thoughts";

const t = (id: number, body: string, over: Partial<Thought> = {}): Thought => ({
  id,
  body,
  source: "written",
  prompt: null,
  clusterId: null,
  placedBy: null,
  createdAt: "2026-11-14T10:00:00.000Z",
  ...over,
});

const input = (over: Partial<ReflectInput> = {}): ReflectInput => ({
  focus: t(7, "i want to ship the game on steam but the animations still look rough"),
  earlier: [{ date: "2026-11-10", gist: "They are making a typing game called Keystrike." }],
  page: ["keystrike: you want it on steam"],
  knowledge: "<what_you_know>\n- Keystrike: a typing game\n</what_you_know>",
  asked: [],
  waved: [],
  ...over,
});

describe("the bird's one question", () => {
  it("shows the bird the whole new thought, what came before, and what not to ask", () => {
    const user = buildReflectUser(input({ asked: ["what would make the animations good enough?"], waved: ["who gets the first slice?"] }));
    expect(user).toContain("the animations still look rough");
    expect(user).toContain("2026-11-10: They are making a typing game called Keystrike.");
    expect(user).toContain("keystrike: you want it on steam");
    expect(user).toContain("what would make the animations good enough?");
    expect(user).toContain("who gets the first slice?");
    // The new thought comes after everything else, right before the instruction.
    expect(user.indexOf("<new_thought")).toBeGreaterThan(user.indexOf("<earlier_thoughts"));
  });

  it("is told when the thought answers its own earlier question", () => {
    const user = buildReflectUser(input({ focus: t(8, "fix the run cycle first", { prompt: "what's the first small step?" }) }));
    expect(user).toContain("what's the first small step?");
    expect(user).toContain("If the answer settles it, stay quiet");
  });

  it("asks for the thought's own language", () => {
    expect(buildReflectUser(input({ focus: t(9, "אני רוצה לסיים את המשחק השנה") }))).toContain("Write the question in Hebrew.");
  });

  it("keeps a plain lowercase question", () => {
    expect(parseReflection({ about: "shipping", kind: "next", question: ' "What is the first animation you would fix?" ' })).toEqual({
      question: "what is the first animation you would fix?",
      kind: "next",
    });
  });

  it("stays quiet when the bird says so, says nothing, or makes up a kind", () => {
    expect(parseReflection({ about: "a note", kind: "quiet", question: "anything?" }).question).toBeNull();
    expect(parseReflection({ about: "a note", kind: "next", question: "   " }).question).toBeNull();
    expect(parseReflection({ about: "x", kind: "poetry", question: "what now?" })).toEqual({ question: null, kind: "quiet" });
    expect(parseReflection({})).toEqual({ question: null, kind: "quiet" });
  });

  it("turns down anything that isn't one plain question", () => {
    const problem = (question: string, over: Partial<ReflectInput> = {}) => problemWithQuestion({ question, kind: "next" }, input(over));
    expect(problem("what is the first animation you would fix?")).toBeNull();
    expect(problem("tell me about the animations")).toMatch(/not a question/);
    expect(problem("what's rough? and what's fine?")).toMatch(/one question/);
    expect(problem("what keeps it alive, like the bread that keeps rising?")).toMatch(/comparisons/);
    expect(problem("have you tried hiring an animator?")).toMatch(/advice/);
    expect(problem("what would you fix first?", { focus: t(9, "אני רוצה לסיים את המשחק השנה") })).toMatch(/Hebrew/);
  });

  it("never repeats a question it asked, or one that was waved away", () => {
    const q = { question: "which animation looks roughest to you?", kind: "block" as const };
    expect(problemWithQuestion(q, input({ asked: ["which animation looks the roughest?"] }))).toMatch(/already asked/);
    expect(problemWithQuestion(q, input({ waved: ["which animation looks roughest?"] }))).toMatch(/waved away/);
    expect(problemWithQuestion({ question: null, kind: "quiet" }, input({ waved: ["anything"] }))).toBeNull();
  });
});

describe("the page", () => {
  it("is empty until the bird writes it, then holds a few lines and one step", () => {
    const db = createDb(":memory:");
    expect(getPage(db)).toEqual({ lines: [], step: null, updatedAt: null });
    const page = savePage(db, {
      lines: [
        { thing: " keystrike ", now: "  you want it on steam;\n the animations   still look rough " },
        { thing: "nothing", now: "   " },
      ],
      step: " fix the run cycle ",
    });
    expect(page.lines).toEqual([{ thing: "keystrike", now: "you want it on steam; the animations still look rough" }]);
    expect(page.step).toBe("fix the run cycle");
    expect(page.updatedAt).not.toBeNull();
    expect(getPage(db)).toEqual(page);
  });

  it("is rewritten in place and never grows past a few lines", () => {
    const db = createDb(":memory:");
    savePage(db, { lines: [{ thing: "a", now: "old" }], step: "old step" });
    const many = Array.from({ length: 9 }, (_, i) => ({ thing: `thing ${i}`, now: `line ${i}` }));
    const page = savePage(db, { lines: many, step: null });
    expect(page.lines).toHaveLength(PAGE_LINES_MAX);
    expect(page.lines[0].now).toBe("line 0");
    expect(page.step).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM page").get() as { n: number }).n).toBe(1);
  });

  it("drops the step when you did it or didn't want it, and remembers which", () => {
    const db = createDb(":memory:");
    savePage(db, { lines: [{ thing: "keystrike", now: "you want it on steam" }], step: "fix the run cycle" });
    expect(answerStep(db, "done").step).toBeNull();
    expect(recentNotes(db, "did", 5).map((n) => n.body)).toEqual(["fix the run cycle"]);
    // The lines stay: only the step went.
    expect(getPage(db).lines).toHaveLength(1);

    savePage(db, { lines: getPage(db).lines, step: "email the publisher" });
    expect(answerStep(db, "dismissed").step).toBeNull();
    expect(recentNotes(db, "nope", 5).map((n) => n.body)).toEqual(["email the publisher"]);
    // Nothing to answer: nothing is written down.
    answerStep(db, "done");
    expect(recentNotes(db, "did", 5)).toHaveLength(1);
  });
});

describe("bubbles that float away", () => {
  it("lets a thought go once the bird has taken it in, without deleting it", () => {
    const db = createDb(":memory:");
    const a = createThought(db, { body: "the game needs better animations" });
    const b = createThought(db, { body: "i should call my sister" });
    createBirdThought(db, "a thought of the bird's own");
    expect(unsettled(db).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(needsDigest(db)).toBe(true);

    settle(db, [a.id]);
    expect(unsettled(db).map((x) => x.id)).toEqual([b.id]);
    const all = listThoughts(db);
    expect(all.find((x) => x.id === a.id)?.settledAt).toBeTruthy();
    expect(floating(all).map((x) => x.id)).toEqual([b.id]);

    settle(db, [a.id, b.id]);
    expect(needsDigest(db)).toBe(false);
    expect(listThoughts(db)).toHaveLength(3);
  });

  it("shows the world only what still floats: no shelves, no links, none of the bird's own", () => {
    const db = createDb(":memory:");
    const a = createThought(db, { body: "the game needs better animations" });
    const b = createThought(db, { body: "i should call my sister" });
    createBirdThought(db, "a thought of the bird's own");
    moveThought(db, b.id, createShelf(db, "family").id, "bird");
    settle(db, [a.id]);

    const view = worldView(getLibrary(db));
    expect(view.thoughts.map((x) => x.id)).toEqual([b.id]);
    expect(view.thoughts[0]).toMatchObject({ clusterId: null, placedBy: null });
    expect(view.clusters).toEqual([]);
    expect(view.links).toEqual([]);
    expect(view.steps).toEqual([]);
  });
});

describe("rewriting the page", () => {
  const base = {
    page: { lines: [{ thing: "keystrike", now: "you want it on steam" }], step: "fix the run cycle", updatedAt: "2026-11-14T10:00:00.000Z" },
    knowledge: "",
    did: ["post the trailer"],
    nope: ["hire an animator"],
    today: "2026-11-18",
  };

  it("gives the bird the old page, what's new, and the steps to leave alone", () => {
    const db = createDb(":memory:");
    const fresh = createThought(db, { body: "my boss shut the team down in the meeting again" });
    saveCard(db, { thoughtId: fresh.id, gist: "They are uneasy about their boss.", subjects: [], feelings: [], todos: ["talk to the boss"] });
    const cards = new Map([[fresh.id, { thoughtId: fresh.id, gist: "They are uneasy about their boss.", subjects: [], feelings: [], todos: ["talk to the boss"], sorted: false }]]);
    const user = buildDigestUser({ ...base, fresh: [fresh], earlier: [t(99, "an old thought the bird never read")], cards });
    expect(user).toContain("- keystrike: you want it on steam");
    expect(user).toContain("<old_step>fix the run cycle</old_step>");
    expect(user).toContain("They are uneasy about their boss. [they want to: talk to the boss]");
    expect(user).toContain("an old thought the bird never read");
    expect(user).toContain("- post the trailer");
    expect(user).toContain("- hire an animator");
    expect(user).toContain("Today is 2026-11-18.");
    expect(user.indexOf("<new_thoughts")).toBeGreaterThan(user.indexOf("<earlier_thoughts"));
  });

  it("keeps one line per thing, a few lines at most", () => {
    const page = parseDigest({
      lines: [
        { thing: "Keystrike:", now: "you want it on steam but the animations look rough" },
        { thing: "keystrike", now: "something else about the same game" },
        { thing: "the game", now: "you want it on steam, but the animations look rough" },
        { thing: "the boss", now: "  you are uneasy after the meeting  " },
        { thing: "empty", now: " " },
      ],
      step: " fix the run cycle ",
    });
    expect(page.lines).toEqual([
      { thing: "keystrike", now: "you want it on steam but the animations look rough" },
      { thing: "the boss", now: "you are uneasy after the meeting" },
    ]);
    expect(page.step).toBe("fix the run cycle");
    const many = Array.from({ length: 12 }, (_, i) => ({ thing: `t${i}`, now: `${"abcdefghijkl"[i]}${i} unique words here` }));
    expect(parseDigest({ lines: many, step: "" }).lines.length).toBeLessThanOrEqual(PAGE_LINES_MAX);
  });

  it("refuses an empty page, and a step you already did or turned down", () => {
    expect(() => parseDigest({ lines: [], step: "do something" })).toThrow();
    expect(() => parseDigest({ lines: [{ thing: "x", now: "  " }] })).toThrow();
    const lines = [{ thing: "keystrike", now: "you want it on steam" }];
    expect(parseDigest({ lines, step: "" }).step).toBeNull();
    expect(parseDigest({ lines, step: "hire an animator today" }, ["hire an animator"]).step).toBeNull();
    expect(parseDigest({ lines, step: "fix the run cycle" }, ["hire an animator"]).step).toBe("fix the run cycle");
  });
});

describe("a quiet bird", () => {
  it("never makes a canned line into a question you'd have to answer or wave away", () => {
    for (const line of [...QUIET, ...POKED, ...SETTLED, ...STEP_NOPE]) expect(line.trim().endsWith("?"), line).toBe(false);
    for (const hello of [greeting(0, null), greeting(3, 0), greeting(3, 1), greeting(3, 4), greeting(3, 10), greeting(3, 90)]) {
      expect(hello.trim().endsWith("?"), hello).toBe(false);
    }
  });

  it("only hums to itself: nothing in its idle lines is about your thoughts", () => {
    for (const line of QUIET) expect(line).not.toMatch(/\b(you|your|this one|bubble)/i);
  });
});
