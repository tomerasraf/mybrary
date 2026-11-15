import { describe, expect, it } from "vitest";
import { buildUser, problemWith, type PonderInput } from "@/lib/ai/ponder";
import { createDb } from "@/lib/db";
import { Feedback, TELL_MAX, takeFeedback } from "@/lib/feedback";
import { knowledgeText, listRules } from "@/lib/knowledge";
import { getLibrary } from "@/lib/library";
import { recentNotes } from "@/lib/notebook";
import type { Thought } from "@/lib/thoughts";

const QUESTION = "who gets the first slice of sourdough?";

const bubble: Thought = {
  id: 1,
  body: "sourdough at 6am again, the starter is finally alive",
  source: "written",
  prompt: null,
  clusterId: null,
  placedBy: null,
  createdAt: "2026-11-14T10:00:00.000Z",
};

const input = (over: Partial<PonderInput> = {}): PonderInput => ({
  mode: "wander",
  focus: bubble,
  bubbles: [bubble],
  cards: new Map(),
  knowledge: "",
  said: [],
  ...over,
});

describe("talking back to the bird", () => {
  it("waving a question away keeps it out of the world and in the bird's notebook", () => {
    const db = createDb(":memory:");
    takeFeedback(db, Feedback.parse({ kind: "skip", question: `  ${QUESTION} ` }));
    expect(recentNotes(db, "waved", 5).map((n) => n.body)).toEqual([QUESTION]);
    expect(getLibrary(db).thoughts).toEqual([]);
    expect(listRules(db)).toEqual([]);
  });

  it("telling the bird something becomes a thing it was told, not a bubble", () => {
    const db = createDb(":memory:");
    takeFeedback(db, Feedback.parse({ kind: "tell", text: "don't ask me about food,   ask about plans" }));
    expect(listRules(db).map((r) => r.body)).toEqual(["don't ask me about food, ask about plans"]);
    expect(knowledgeText(db)).toContain("- don't ask me about food, ask about plans");
    expect(getLibrary(db).thoughts).toEqual([]);
    expect(recentNotes(db, "waved", 5)).toEqual([]);
  });

  it("what you say about a question is kept with the question, and the question isn't asked again", () => {
    const db = createDb(":memory:");
    takeFeedback(db, Feedback.parse({ kind: "tell", text: "that's a weird thing to ask", about: QUESTION }));
    expect(listRules(db)[0].body).toBe(`when you asked "${QUESTION}" they said: that's a weird thing to ask`);
    expect(recentNotes(db, "waved", 5).map((n) => n.body)).toEqual([QUESTION]);
  });

  it("refuses nothing, and things too long to remember", () => {
    expect(Feedback.safeParse({ kind: "tell", text: "   " }).success).toBe(false);
    expect(Feedback.safeParse({ kind: "tell", text: "x".repeat(TELL_MAX + 1) }).success).toBe(false);
    expect(Feedback.safeParse({ kind: "skip", question: "" }).success).toBe(false);
    expect(Feedback.safeParse({ kind: "shout", text: "hi" }).success).toBe(false);
  });
});

describe("the bird remembers what you waved away", () => {
  it("shows the brain the questions you didn't want", () => {
    expect(buildUser(input())).not.toContain("questions_they_waved_away");
    const user = buildUser(input({ waved: [QUESTION] }));
    expect(user).toContain("<questions_they_waved_away");
    expect(user).toContain(`- ${QUESTION}`);
  });

  it("turns down the same question asked again, but not a plain line about the same thing", () => {
    const waved = [QUESTION];
    const again = { id: 1, line: "so who gets the first sourdough slice?", links: [], detail: "sourdough at 6am" };
    expect(problemWith(again, input({ waved }))).toMatch(/^they waved away/);
    const plain = { id: 1, line: "the first slice of sourdough gets all my respect.", links: [], detail: "sourdough at 6am" };
    expect(problemWith(plain, input({ waved }))).toBeNull();
    expect(problemWith(again, input())).toBeNull();
  });
});
