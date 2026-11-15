import { describe, expect, it } from "vitest";
import { PONDER_SCHEMA, buildUser, languageOf, parsePonder, problemWith, tooSimilar, type PonderInput } from "@/lib/ai/ponder";
import { brainConfig, cleanJsonText, providerOrder } from "@/lib/ai/llm";
import { createDb } from "@/lib/db";
import { NOTEBOOK_KEEP, addNote, recentNotes } from "@/lib/notebook";
import { createThought, type Thought } from "@/lib/thoughts";

const t = (id: number, body: string, prompt: string | null = null): Thought => ({
  id,
  body,
  source: "written",
  prompt,
  clusterId: null,
  placedBy: null,
  createdAt: "2026-11-14T10:00:00.000Z",
});

const BUBBLES = [t(1, "scared to finish the game"), t(2, "i miss cooking for friends"), t(3, "new city, no one knows me")];

const base = (over: Partial<PonderInput> = {}): PonderInput => ({
  mode: "wander",
  focus: BUBBLES[1],
  bubbles: BUBBLES,
  cards: new Map(),
  knowledge: "",
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
  it("asks for the detail before the line", () => {
    expect(PONDER_SCHEMA.required).toEqual(["detail", "line", "links"]);
  });

  it("puts what it knows, past lines, the other bubbles' summaries and the whole bubble in the prompt", () => {
    const long = t(4, `${"word ".repeat(500)}the very end`, 'what do you "really" want?');
    const user = buildUser(
      base({
        focus: long,
        bubbles: [...BUBBLES, long],
        knowledge: "<what_you_know>\n- Dana: my sister\n</what_you_know>",
        cards: new Map([[1, { thoughtId: 1, gist: "they are afraid to finish their game", subjects: [], feelings: [], todos: [], sorted: false }]]),
        said: [{ id: 2, kind: "said", body: "this one again", thoughtId: 1, createdAt: "" }],
      }),
    );
    expect(user).toContain("Dana: my sister");
    expect(user).toContain("this one again");
    expect(user).toContain('<bubble id="1">they are afraid to finish their game</bubble>');
    expect(user).toContain('<bubble id="2">i miss cooking for friends</bubble>');
    expect(user).toContain("the very end");
    expect(user).toContain(`answering="what do you 'really' want?"`);
    expect(user).toContain("You walked over to this bubble");
    const answer = buildUser(base({ mode: "new", focus: t(4, "b", "what do you want?") }));
    expect(answer).toContain("their answer to your question");
  });

  it("speaks about the bubble it was given, and links only real ones", () => {
    const ok = parsePonder({ detail: "cooking for friends", line: ' "who sat at your table?" ', links: [2, 3, 3, 99] }, base());
    expect(ok).toEqual({ id: 2, line: "who sat at your table?", links: [3], detail: "cooking for friends" });
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
    // Two different thoughts that share only the little words.
    expect(
      tooSimilar(
        "maybe the guitar course is like the sourdough starter, needs more time, not more starts.",
        "maybe the budget is like the garden, you have to tend it, not just look at it.",
      ),
    ).toBe(false);
  });

  it("flags a made-up detail, the wrong language, or a line it already said", () => {
    const hebrew = t(1, "אני מתחיל דברים ולא מסיים");
    const said = [{ id: 1, kind: "said" as const, body: "cooking for friends is a kind of home", thoughtId: 2, createdAt: "" }];
    const he = base({ focus: hebrew, bubbles: [hebrew, BUBBLES[1]], said });
    const en = base({ said });
    const line = (text: string, detail: string) => ({ id: 0, line: text, links: [], detail });
    expect(problemWith(line("you start things", "מתחיל דברים ולא מסיים"), he)).toMatch(/Hebrew/);
    expect(problemWith(line("אתה מתחיל ולא מסיים", "מתחיל דברים ולא מסיים"), he)).toBeNull();
    expect(problemWith(line("who sat at your table?", "i fear nobody likes my food"), en)).toMatch(/copied exactly/);
    expect(problemWith(line("cooking for friends is your kind of home", "cooking for friends"), en)).toMatch(/already said/);
    expect(problemWith(line("who used to eat at your table?", "cooking for friends"), en)).toBeNull();
  });
});

describe("notebook", () => {
  it("keeps pages in order, skips blanks and repeats, and forgets the oldest", () => {
    const db = createDb(":memory:");
    expect(addNote(db, "said", "  ooh,   sourdough ")?.body).toBe("ooh, sourdough");
    expect(addNote(db, "said", "Ooh, sourdough")).toBeNull();
    expect(addNote(db, "said", "   ")).toBeNull();
    addNote(db, "said", "which box first?");
    expect(recentNotes(db, "said", 5).map((n) => n.body)).toEqual(["ooh, sourdough", "which box first?"]);
    for (let i = 0; i < NOTEBOOK_KEEP + 5; i++) addNote(db, "said", `page ${i}`);
    expect(recentNotes(db, "said", 1000)).toHaveLength(NOTEBOOK_KEEP);
    expect(recentNotes(db, "said", 1)[0].body).toBe(`page ${NOTEBOOK_KEEP + 4}`);
  });

  it("stores the bird's question with an answer", () => {
    const db = createDb(":memory:");
    expect(createThought(db, { body: "a thing" }).prompt).toBeNull();
    expect(createThought(db, { body: "honestly, rest", prompt: "  what do you want?  " }).prompt).toBe("what do you want?");
  });
});
