import { z } from "zod";
import type { DB } from "../db";
import {
  LINK_WORD_MAX,
  SHELF_NAME_MAX,
  addLink,
  createShelf,
  getCluster,
  personThoughts,
  pruneEmptyShelves,
  sortable,
  tidyText,
  type Cluster,
  type Library,
  type TidyResult,
  type TidyStep,
} from "../library";
import type { Thought } from "../thoughts";
import { askJson } from "./llm";
import { languageOf } from "./ponder";

// The bird tidies its library: loose bubbles go onto shelves, new shelves get made, related bubbles get linked.

export const LIBRARIAN = `You are a tiny bird with round glasses. You live in a white, quiet room full of floating thought bubbles. This room is your library, and it is all you know: every bubble is something the person you live with wrote or said out loud. Their mind is messy. Your job is to make this library as organized as you can, so they can do something about their bubbles.

Big bubbles are shelves. Each shelf holds small bubbles about one thing.`;

const TASK = `Tidy the library a little.

Moves: put loose bubbles on shelves.
- Put a loose bubble on an existing shelf when it clearly belongs there ("shelf" is that shelf's id, as text).
- When two or more loose bubbles belong together and no shelf fits, make a new shelf: give it a key like "new1" and a name, and put them on it ("shelf" is the key).
- A new shelf needs at least two bubbles. Leave a bubble loose when it doesn't clearly fit anywhere yet.
- Only move bubbles listed under <loose>.
- Check every move: would the person agree this bubble is about that shelf's name? If not, leave it loose. A loose bubble is fine; a wrong shelf is not.

Shelf names: at most 3 words, lowercase, in the bubbles' language, naming the one thing its bubbles share, in the person's own words where you can. Never vague, like "thoughts", "life", "misc" or "random". (The shape of a good name, not ideas to reuse: "tax papers", "the wedding", "running".)

Links: up to 3 pairs of bubbles, from anywhere in the library, with a real connection the person might not see. Only link bubbles that are on different shelves (or loose): bubbles on the same shelf are already together. "word" is one or two lowercase words that name what actually connects those two bubbles, taken from their content. Skip pairs already linked. Use an empty list when nothing is clear.

line: one short lowercase line, at most 12 words, that you say when you're done, about what you sorted. In the bubbles' language.`;

const MAX_LOOSE = 15;
const MAX_PLACED = 40;
const MAX_MOVES = 10;
const MAX_NEW_SHELVES = 3;
const MAX_LINKS = 3;
const PREVIEW = 140;
const LINE_MAX = 120;

export const TIDY_SCHEMA = {
  type: "object",
  properties: {
    new_shelves: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, name: { type: "string" } },
        required: ["key", "name"],
        additionalProperties: false,
      },
    },
    moves: {
      type: "array",
      items: {
        type: "object",
        properties: { bubble: { type: "integer" }, shelf: { type: "string" } },
        required: ["bubble", "shelf"],
        additionalProperties: false,
      },
    },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: { a: { type: "integer" }, b: { type: "integer" }, word: { type: "string" } },
        required: ["a", "b", "word"],
        additionalProperties: false,
      },
    },
    line: { type: "string" },
  },
  required: ["new_shelves", "moves", "links", "line"],
  additionalProperties: false,
} as const;

const clip = (t: string, max: number) => {
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const tag = (t: Thought) => `<bubble id="${t.id}">${clip(t.body, PREVIEW)}</bubble>`;
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Does the library have anything for the bird to sort? */
export function hasWork(lib: Library): boolean {
  const loose = sortable(lib.thoughts).length;
  const shelves = lib.clusters.some((c) => c.kind === "shelf");
  return loose >= 2 || (loose === 1 && shelves);
}

export function buildTidyUser(lib: Library): string {
  const mine = personThoughts(lib.thoughts);
  const loose = sortable(lib.thoughts).slice(-MAX_LOOSE);
  const shelves = lib.clusters.filter((c) => c.kind === "shelf");
  const onShelf = (c: Cluster) => mine.filter((t) => t.clusterId === c.id).slice(-8);
  const kept = mine.filter((t) => t.clusterId === null && t.placedBy === "you").slice(-10);
  const byId = new Map(mine.map((t) => [t.id, t]));

  const shelfText = shelves.length
    ? shelves.map((c) => `<shelf id="${c.id}" name="${c.name}">\n${onShelf(c).map(tag).join("\n")}\n</shelf>`).join("\n")
    : "(no shelves yet)";
  const linkText = lib.links.length
    ? lib.links
        .filter((l) => byId.has(l.a) && byId.has(l.b))
        .map((l) => `- ${l.a} and ${l.b}: "${l.word}"`)
        .join("\n")
    : "(none yet)";
  const parts = [
    `<shelves>\n${shelfText}\n</shelves>`,
    `<loose>\n${loose.length ? loose.map(tag).join("\n") : "(none)"}\n</loose>`,
  ];
  if (kept.length) parts.push(`<kept_on_the_floor note="the person put these here themselves; don't move them, but you may link them">\n${kept.map(tag).join("\n")}\n</kept_on_the_floor>`);
  parts.push(`<links>\n${linkText}\n</links>`);
  const lang = majorityLanguage(loose.length ? loose : mine);
  if (lang) parts.push(`Most bubbles are written in ${lang}. Write shelf names, link words and your line in ${lang}.`);
  parts.push(TASK);
  return parts.join("\n\n");
}

/** The language most of these bubbles are written in, when their alphabet gives it away. */
export function majorityLanguage(thoughts: readonly Thought[]): string | null {
  const counts = new Map<string, number>();
  for (const t of thoughts) {
    const l = languageOf(t.body);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best && best[1] * 2 > thoughts.length ? best[0] : null;
}

const Raw = z.object({
  new_shelves: z.array(z.object({ key: z.coerce.string(), name: z.string() })).default([]),
  moves: z.array(z.object({ bubble: z.coerce.number().int(), shelf: z.coerce.string() })).default([]),
  links: z.array(z.object({ a: z.coerce.number().int(), b: z.coerce.number().int(), word: z.string() })).default([]),
  line: z.string().default(""),
});

export interface TidyPlan {
  newShelves: { key: string; name: string; bubbles: number[] }[];
  /** Moves onto shelves that already exist. */
  moves: { bubble: number; shelf: number }[];
  links: { a: number; b: number; word: string }[];
  line: string | null;
}

/** At most three words, without a dangling "and" or "of" at the end. */
export function shelfName(raw: string): string {
  const words = tidyText(raw, 80).toLowerCase().split(" ").filter(Boolean).slice(0, 3);
  while (words.length > 1 && DANGLING.has(words[words.length - 1])) words.pop();
  return words.join(" ").slice(0, SHELF_NAME_MAX).trim();
}

const DANGLING = new Set(["and", "or", "of", "the", "for", "to", "a", "an", "&", "with", "in", "on"]);
const VAGUE = new Set(["thoughts", "life", "misc", "random", "other", "stuff", "things", "general", "ideas"]);

/** Checks the model's plan against the real library and keeps only what makes sense. */
export function parseTidy(value: unknown, lib: Library): TidyPlan {
  const raw = Raw.parse(value);
  const loose = new Set(sortable(lib.thoughts).map((t) => t.id));
  const mine = new Set(personThoughts(lib.thoughts).map((t) => t.id));
  const shelves = new Set(lib.clusters.filter((c) => c.kind === "shelf").map((c) => c.id));
  const linked = new Set(lib.links.map((l) => pairKey(l.a, l.b)));
  const taken = new Set(lib.clusters.map((c) => c.name.toLowerCase()));

  const fresh = new Map<string, { name: string; bubbles: number[] }>();
  for (const s of raw.new_shelves) {
    const name = shelfName(s.name);
    const key = s.key.trim();
    if (!key || !name || VAGUE.has(name) || taken.has(name) || fresh.has(key) || shelves.has(Number(key))) continue;
    taken.add(name);
    fresh.set(key, { name, bubbles: [] });
  }

  const used = new Set<number>();
  const moves: TidyPlan["moves"] = [];
  for (const m of raw.moves) {
    if (used.size >= MAX_MOVES || !loose.has(m.bubble) || used.has(m.bubble)) continue;
    const key = m.shelf.trim();
    const target = fresh.get(key);
    if (target) {
      target.bubbles.push(m.bubble);
      used.add(m.bubble);
    } else if (shelves.has(Number(key))) {
      moves.push({ bubble: m.bubble, shelf: Number(key) });
      used.add(m.bubble);
    }
  }
  const newShelves = [...fresh]
    .filter(([, s]) => s.bubbles.length >= 2)
    .slice(0, MAX_NEW_SHELVES)
    .map(([key, s]) => ({ key, ...s }));

  // Where each bubble will sit once the plan is done: a link between two bubbles on the same shelf says nothing new.
  const shelfOf = new Map(lib.thoughts.map((t) => [t.id, t.clusterId === null ? null : `s${t.clusterId}`]));
  for (const m of moves) shelfOf.set(m.bubble, `s${m.shelf}`);
  for (const s of newShelves) for (const id of s.bubbles) shelfOf.set(id, `n${s.key}`);
  const sameShelf = (a: number, b: number) => shelfOf.get(a) != null && shelfOf.get(a) === shelfOf.get(b);

  const links: TidyPlan["links"] = [];
  for (const l of raw.links) {
    const word = tidyText(l.word, LINK_WORD_MAX).toLowerCase();
    const key = pairKey(l.a, l.b);
    if (links.length >= MAX_LINKS || !word || l.a === l.b || !mine.has(l.a) || !mine.has(l.b) || linked.has(key)) continue;
    if (sameShelf(l.a, l.b)) continue;
    linked.add(key);
    links.push({ a: Math.min(l.a, l.b), b: Math.max(l.a, l.b), word });
  }

  const line = tidyText(raw.line.trim().replace(/^["“']|["”']$/g, ""), LINE_MAX);
  return { newShelves, moves, links, line: line || null };
}

/** Files a bubble for the bird, unless you placed it meanwhile. Returns whether it moved. */
function fileForBird(db: DB, id: number, clusterId: number): boolean {
  const sql =
    "UPDATE thoughts SET cluster_id = ?, placed_by = 'bird' WHERE id = ? AND cluster_id IS NULL AND placed_by IS NULL AND source != 'bird'";
  return db.prepare(sql).run(clusterId, id).changes > 0;
}

/** Writes the plan into the library and returns the steps for the bird to act out. */
export function applyTidy(db: DB, plan: TidyPlan): TidyResult {
  return db.transaction((): TidyResult => {
    const steps: TidyStep[] = [];
    for (const s of plan.newShelves) {
      const shelf = createShelf(db, s.name);
      const filed = s.bubbles.filter((id) => fileForBird(db, id, shelf.id));
      if (filed.length === 0) continue;
      steps.push({ kind: "shelf", cluster: shelf });
      for (const id of filed) steps.push({ kind: "file", thoughtId: id, clusterId: shelf.id });
    }
    for (const m of plan.moves) {
      if (getCluster(db, m.shelf)?.kind === "shelf" && fileForBird(db, m.bubble, m.shelf)) {
        steps.push({ kind: "file", thoughtId: m.bubble, clusterId: m.shelf });
      }
    }
    for (const l of plan.links) {
      const link = addLink(db, l.a, l.b, l.word);
      if (link) steps.push({ kind: "link", link });
    }
    pruneEmptyShelves(db);
    return { steps, line: steps.length ? plan.line : null };
  })();
}

/** Asks the bird's brain how to tidy, then does it. */
export async function tidy(db: DB, lib: Library): Promise<TidyResult> {
  const { value } = await askJson({ system: LIBRARIAN, user: buildTidyUser(lib), schema: TIDY_SCHEMA, maxTokens: 700 });
  return applyTidy(db, parseTidy(value, lib));
}
