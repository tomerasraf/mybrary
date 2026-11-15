import { z } from "zod";
import { getCards, type Card } from "../cards";
import type { DB } from "../db";
import { SHELF_ABOUT_MAX, describeShelf, personThoughts, shelvesToDescribe, tidyText, type Cluster } from "../library";
import { listThoughts, type Thought } from "../thoughts";
import { askJson } from "./llm";
import { LIBRARIAN, majorityLanguage } from "./tidy";

// For every shelf the bird keeps one sentence: what belongs here. It sorts new bubbles against
// that sentence, so a shelf means the same thing tomorrow as it does today. You can rewrite it.

export const ABOUT_SCHEMA = {
  type: "object",
  properties: { holds: { type: "string" } },
  required: ["holds"],
  additionalProperties: false,
} as const;

const MEMBERS_SHOWN = 12;

export function buildAboutUser(shelf: Cluster, members: readonly Thought[], cards: ReadonlyMap<number, Card>): string {
  const lines = members.flatMap((t) => {
    const card = cards.get(t.id);
    return card ? [`- ${card.gist}${t.placedBy === "you" ? " (placed here by the person)" : ""}`] : [];
  });
  const lang = majorityLanguage(members);
  return [
    `<shelf name="${shelf.name}">\n${lines.join("\n")}\n</shelf>`,
    `Write "holds": one plain sentence, at most 22 words, saying what belongs on this shelf, so that later you can tell which new bubbles go on it and which don't.

- Name the one thing these bubbles share: the project, person, place or plan, in the person's own words.
- Only what the bubbles above say. Nothing about what the person feels or should do.
- Start with what it holds ("bubbles about…" is fine).${lang ? `\n- Write it in ${lang}.` : ""}`,
  ].join("\n\n");
}

const Raw = z.object({ holds: z.string() });

export function parseAbout(value: unknown): string | null {
  const text = tidyText(Raw.parse(value).holds, SHELF_ABOUT_MAX).replace(/^["“']|["”']$/g, "");
  return text.split(" ").length >= 3 ? text : null;
}

/** The next shelf that needs its sentence written (or rewritten, because bubbles came or went). */
export function shelfToDescribe(db: DB): Cluster | null {
  return shelvesToDescribe(db)[0] ?? null;
}

/** Writes one shelf's sentence. Returns false when the brain gave nothing usable. */
export async function describeOne(db: DB, shelf: Cluster): Promise<boolean> {
  const cards = getCards(db);
  const all = personThoughts(listThoughts(db)).filter((t) => t.clusterId === shelf.id && cards.has(t.id));
  if (all.length === 0) return false;
  const { value } = await askJson({
    system: LIBRARIAN,
    user: buildAboutUser(shelf, all.slice(-MEMBERS_SHOWN), cards),
    schema: ABOUT_SCHEMA,
    maxTokens: 120,
    temperature: 0.2,
  });
  const about = parseAbout(value);
  return about ? describeShelf(db, shelf.id, about, all.length) : false;
}
