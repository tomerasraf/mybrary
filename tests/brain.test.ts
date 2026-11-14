import { describe, expect, it } from "vitest";
import { buildUser, languageOf, parsePonder, problemWith, schemaFor, tooSimilar, type PonderInput } from "@/lib/ai/ponder";
import { brainConfig, cleanJsonText, providerOrder } from "@/lib/ai/llm";
import { createDb } from "@/lib/db";
import { NOTEBOOK_KEEP, addNote, recentNotes } from "@/lib/notebook";
import { createThought, type Thought } from "@/lib/thoughts";

const t = (id: number, body: string, prompt: string | null = null): Thought => ({
  id,
  body,
  source: "written",
  prompt,
  createdAt: "2026-11-14T10:00:00.000Z",
});

const base = (over: Partial<PonderInput> = {}): PonderInput => ({
  mode: "wander",
  bubbles: [t(1, "scared to finish the game"), t(2, "i miss cooking for friends"), t(3, "new city, no one knows me")],
  avoid: [],
  notes: [],
  said: [],
  ...over,
});

describe("brain config", () => {
  it("defaults to the local model and falls back to Claude only with a key", () => {
    const local = brainConfig({});
    expect(local).toEqual({ primary: "ollama", ollamaUrl: "http://127.0.0.1:11434", ollamaModel: "qwen3:8b", ollamaThink: false });
    expect(providerOrder(local, false)).toEqual(["ollama"]);
    expect(providerOrder(local, true)).toEqual(["ollama", "claude"]);
    const claude = brainConfig({ BIRD_BRAIN: "claude", OLLAMA_URL: "http://box:11434/", OLLAMA_MODEL: "gemma3:12b" });
    expect(claude.ollamaUrl).toBe("http://box:11434");
    expect(providerOrder(claude, true)).toEqual(["claude", "ollama"]);
  });

  it("strips think blocks and code fences around JSON", () => {
    expect(cleanJsonText('<think>\nhmm\n</think>\n```json\n{"line":"hi"}\n```')).toBe('{"line":"hi"}');
  });
});

describe("pondering", () => {
  it("only asks for a visit when wandering", () => {
    expect((schemaFor("wander").required as string[]).includes("visit")).toBe(true);
    expect((schemaFor("new").required as string[]).includes("visit")).toBe(false);
  });

  it("puts the notebook, past lines, avoided bubbles and the bird's question in the prompt", () => {
    const user = buildUser(
      base({
        avoid: [2],
        notes: [{ id: 1, kind: "note", body: "they fear endings", thoughtId: 1, createdAt: "" }],
        said: [{ id: 2, kind: "said", body: "this one again", thoughtId: 1, createdAt: "" }],
        bubbles: [t(1, "a"), t(4, "b", 'what do you "really" want?')],
      }),
    );
    expect(user).toContain("they fear endings");
    expect(user).toContain("this one again");
    expect(user).toContain("Don't choose 2.");
    expect(user).toContain(`answering="what do you 'really' want?"`);
    const answer = buildUser(base({ mode: "new", focus: t(4, "b", "what do you want?") }));
    expect(answer).toContain("their answer to your question");
  });

  it("keeps only real bubbles and falls back when the model picks a bad one", () => {
    const ok = parsePonder({ visit: "2", line: ' "you cook, you build… both feed people?" ', note: "x", links: [2, 3, 3, 99] }, base());
    expect(ok).toEqual({ id: 2, line: "you cook, you build… both feed people?", note: "x", links: [3] });
    const bad = parsePonder({ visit: 99, line: "hm" }, base({ avoid: [1] }));
    expect(bad.id).toBe(2);
    expect(bad.links).toEqual([]);
    const born = parsePonder({ visit: 3, line: "welcome", links: [4] }, base({ mode: "new", focus: t(4, "new one") }));
    expect(born.id).toBe(4);
    expect(() => parsePonder({ line: "   " }, base())).toThrow();
    expect(parsePonder({ line: "x".repeat(400) }, base()).line.length).toBeLessThanOrEqual(161);
  });
});

describe("keeping the bird honest", () => {
  it("recognises languages by alphabet", () => {
    expect(languageOf("אני מרגיש שאני כל הזמן מתחיל דברים")).toBe("Hebrew");
    expect(languageOf("i miss cooking")).toBeNull();
    expect(languageOf("... 123")).toBeNull();
  });

  it("spots lines that repeat an earlier one", () => {
    expect(tooSimilar("you tie belonging to others' reactions", "you're still tying belonging to others' reactions")).toBe(true);
    expect(tooSimilar("you tie belonging to others' reactions", "what would you cook first?")).toBe(false);
  });

  it("flags a line in the wrong language or one it already said", () => {
    const input = base({ bubbles: [t(1, "אני מתחיל דברים ולא מסיים"), t(2, "i miss cooking")], said: [{ id: 1, kind: "said", body: "cooking for friends is a kind of home", thoughtId: 2, createdAt: "" }] });
    expect(problemWith({ id: 1, line: "you start things", note: "", links: [] }, input)).toMatch(/Hebrew/);
    expect(problemWith({ id: 1, line: "אתה מתחיל ולא מסיים", note: "", links: [] }, input)).toBeNull();
    expect(problemWith({ id: 2, line: "cooking for friends is your kind of home", note: "", links: [] }, input)).toMatch(/already said/);
    expect(problemWith({ id: 2, line: "who used to eat at your table?", note: "", links: [] }, input)).toBeNull();
  });
});

describe("notebook", () => {
  it("keeps pages in order, skips blanks and repeats, and forgets the oldest", () => {
    const db = createDb(":memory:");
    expect(addNote(db, "note", "  they   fear endings ")?.body).toBe("they fear endings");
    expect(addNote(db, "note", "They fear endings")).toBeNull();
    expect(addNote(db, "note", "   ")).toBeNull();
    addNote(db, "said", "hello");
    addNote(db, "note", "they love feeding people");
    expect(recentNotes(db, "note", 5).map((n) => n.body)).toEqual(["they fear endings", "they love feeding people"]);
    expect(recentNotes(db, "said", 5)).toHaveLength(1);
    for (let i = 0; i < NOTEBOOK_KEEP + 5; i++) addNote(db, "note", `page ${i}`);
    expect(recentNotes(db, "note", 1000)).toHaveLength(NOTEBOOK_KEEP);
    expect(recentNotes(db, "note", 1)[0].body).toBe(`page ${NOTEBOOK_KEEP + 4}`);
  });

  it("stores the bird's question with an answer", () => {
    const db = createDb(":memory:");
    expect(createThought(db, { body: "a thing" }).prompt).toBeNull();
    expect(createThought(db, { body: "honestly, rest", prompt: "  what do you want?  " }).prompt).toBe("what do you want?");
  });
});
