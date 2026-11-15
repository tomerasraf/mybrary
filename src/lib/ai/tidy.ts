import { z } from "zod";
import { getCards, markSorted, toReview, type Card } from "../cards";
import type { DB } from "../db";
import { knowledgeText, listFacts } from "../knowledge";
import {
  LINK_WORD_MAX,
  SHELF_ABOUT_MAX,
  SHELF_NAME_MAX,
  WHY_MAX,
  addLink,
  createShelf,
  getLibrary,
  personThoughts,
  describeShelf,
  poppedPairs,
  pruneEmptyShelves,
  sortable,
  tidyText,
  type Cluster,
  type Library,
  type TidyResult,
  type TidyStep,
} from "../library";
import type { Thought } from "../thoughts";
import { grounded, mentions, nameKey } from "./ground";
import { askJson } from "./llm";
import { languageOf } from "./ponder";

// The bird tidies its library. It decides about one bubble at a time, from the card it wrote when it
// read the whole bubble, and says why before it chooses. It also looks again at bubbles it filed
// before it had read them, groups loose bubbles into new shelves, and links bubbles that share something real.

export const LIBRARIAN = `You are a tiny bird with round glasses. You live in a white, quiet room full of floating thought bubbles. This room is your library, and it is all you know: every bubble is something the person you live with wrote or said out loud. Their mind is messy. Your job is to make this library as organized as you can, so they can do something about their bubbles.

Big bubbles are shelves. Each shelf holds small bubbles about one thing. You only go by what the bubbles say. You never guess.`;

const MAX_PLACEMENTS = 4;
const MAX_REVIEWS = 3;
const MAX_NEW_SHELVES = 2;
const MAX_LINK_TRIES = 2;
const MEMBERS_SHOWN = 8;
const BODY_SHOWN = 1500;
/** The bird stops starting new decisions after this long, so the person isn't left waiting. */
const BUDGET_MS = 50_000;

const clip = (t: string, max: number) => {
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const shelvesOf = (lib: Library) => lib.clusters.filter((c) => c.kind === "shelf");

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

/** At most three words, without a dangling "and" or "of" at the end. */
export function shelfName(raw: string): string {
  const words = tidyText(raw, 80).toLowerCase().split(" ").filter(Boolean).slice(0, 3);
  while (words.length > 1 && DANGLING.has(words[words.length - 1])) words.pop();
  return words.join(" ").slice(0, SHELF_NAME_MAX).trim();
}

const DANGLING = new Set(["and", "or", "of", "the", "for", "to", "a", "an", "&", "with", "in", "on", "-"]);
const VAGUE = new Set(["thoughts", "life", "misc", "random", "other", "stuff", "things", "general", "ideas"]);

// ---------- what there is to do ----------

/** Bubbles the bird filed before it had read them, and should look at again. */
function reviewable(lib: Library, cards: Map<number, Card>): Thought[] {
  return personThoughts(lib.thoughts).filter(
    (t) => t.clusterId !== null && t.placedBy === "bird" && cards.get(t.id)?.sorted === false,
  );
}

/** Does the library have anything for the bird to sort? */
export function hasWork(db: DB, lib: Library): boolean {
  const loose = sortable(lib.thoughts).length;
  return loose >= 2 || (loose === 1 && shelvesOf(lib).length > 0) || toReview(db) > 0;
}

// ---------- one bubble: which shelf? ----------

export const PLACE_SCHEMA = {
  type: "object",
  properties: { reason: { type: "string" }, shelf: { type: "string" } },
  required: ["reason", "shelf"],
  additionalProperties: false,
} as const;

const PLACE_TASK = `Which shelf does this bubble belong on?

- "reason": first, one short sentence the person will read: what the bubble is mainly about, and which shelf (if any) is about that same thing. Use <what_you_know> to tell similar things apart.
- "shelf": that shelf's id, or "none".
- Choose a shelf only if the person would agree the bubble is about what that shelf's name says. Two different projects, people or places never share a shelf just because they are the same kind of thing.
- A shelf's "holds" line says what belongs on it. When the person wrote it, it is the rule for that shelf.
- Bubbles marked as placed by the person show what that shelf is really for.
- "none" is a good answer. A wrong shelf is not.`;

function shelfText(lib: Library, cards: Map<number, Card>, except: number): string {
  const mine = personThoughts(lib.thoughts);
  const shelves = shelvesOf(lib);
  if (shelves.length === 0) return "(no shelves yet)";
  return shelves
    .map((c) => {
      const on = mine.filter((t) => t.clusterId === c.id && t.id !== except).slice(-MEMBERS_SHOWN);
      const lines = on.map((t) => {
        const gist = cards.get(t.id)?.gist ?? clip(t.body, 200);
        return `- ${gist}${t.placedBy === "you" ? " (placed here by the person)" : ""}`;
      });
      const holds = c.about ? `holds: ${c.about}${c.aboutBy === "you" ? " (the person wrote this)" : ""}\n` : "";
      return `<shelf id="${c.id}" name="${c.name}">\n${holds}${lines.length ? lines.join("\n") : "(nothing else on it)"}\n</shelf>`;
    })
    .join("\n");
}

export function buildPlaceUser(lib: Library, cards: Map<number, Card>, knowledge: string, thought: Thought): string {
  const card = cards.get(thought.id);
  const current = thought.clusterId === null ? null : lib.clusters.find((c) => c.id === thought.clusterId);
  const parts = [
    knowledge,
    `<shelves>\n${shelfText(lib, cards, thought.id)}\n</shelves>`,
    // A short answer ("yeah, i guess so") only means something next to the question it answers.
    `<bubble>\n${thought.prompt ? `answering your question: ${clip(thought.prompt, 200)}\n` : ""}${
      card ? `about: ${card.gist}\n` : ""
    }in full: ${clip(thought.body, BODY_SHOWN)}\n</bubble>`,
  ];
  if (current) {
    parts.push(
      `Right now this bubble sits on "${current.name}" (id ${current.id}). You put it there before you had read all of it, so check again: keep it there only if it truly fits.`,
    );
  }
  parts.push(PLACE_TASK);
  return parts.join("\n\n");
}

const RawPlace = z.object({ reason: z.string().default(""), shelf: z.coerce.string() });

/** The shelf the model chose, or null for "none" (or anything that isn't a real shelf). */
export function parsePlace(value: unknown, lib: Library): number | null {
  const raw = RawPlace.parse(value);
  const id = Number(raw.shelf.trim().replace(/^id\s*/i, ""));
  return shelvesOf(lib).some((c) => c.id === id) ? id : null;
}

/** The bird's one sentence on why, to show the person later. */
export function parseReason(value: unknown): string | null {
  const reason = (value as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" && reason.trim() ? tidyText(reason, WHY_MAX) : null;
}

// ---------- loose bubbles: new shelves ----------

export const GROUP_SCHEMA = {
  type: "object",
  properties: {
    shelves: {
      type: "array",
      items: {
        type: "object",
        properties: {
          reason: { type: "string" },
          name: { type: "string" },
          holds: { type: "string" },
          bubbles: { type: "array", items: { type: "integer" } },
        },
        required: ["reason", "name", "holds", "bubbles"],
        additionalProperties: false,
      },
    },
  },
  required: ["shelves"],
  additionalProperties: false,
} as const;

const GROUP_TASK = `These loose bubbles fit none of your shelves. Do any of them belong together on a new shelf?

- A new shelf needs at least two bubbles that are about the very same thing: the same project, the same person, the same plan. Not just the same kind of thing.
- "reason": first, one sentence on what exactly those bubbles share.
- "name": at most 3 words, lowercase, naming that one thing in the person's own words. Never vague, like "thoughts", "life", "misc" or "random". (The shape of a good name, not ideas to reuse: "tax papers", "the wedding", "running".)
- "holds": one plain sentence saying what belongs on this shelf, so you can tell later what goes on it and what doesn't.
- "bubbles": their ids.
- Most of the time the right answer is an empty list. A loose bubble is fine; a forced shelf is not.`;

export function buildGroupUser(lib: Library, cards: Map<number, Card>, knowledge: string, loose: readonly Thought[]): string {
  const names = shelvesOf(lib).map((c) => `- ${c.name}`);
  const tags = loose.map((t) => `<bubble id="${t.id}">${cards.get(t.id)?.gist ?? clip(t.body, 200)}</bubble>`);
  const lang = majorityLanguage(loose);
  return [
    knowledge,
    `<shelves_you_have>\n${names.length ? names.join("\n") : "(none yet)"}\n</shelves_you_have>`,
    `<loose>\n${tags.join("\n")}\n</loose>`,
    `${GROUP_TASK}${lang ? `\n- Write shelf names in ${lang}.` : ""}`,
  ].join("\n\n");
}

const RawGroup = z.object({
  shelves: z
    .array(
      z.object({
        name: z.string(),
        bubbles: z.array(z.coerce.number().int()),
        reason: z.string().optional(),
        holds: z.string().optional(),
      }),
    )
    .default([]),
});

export interface NewShelf {
  name: string;
  bubbles: number[];
  /** What the bubbles share, in the bird's words. */
  reason?: string;
  /** What belongs on the shelf. */
  holds?: string;
}

/** New shelves worth making: a real name, and at least two of the loose bubbles each. */
export function parseGroups(value: unknown, lib: Library, loose: readonly Thought[]): NewShelf[] {
  const raw = RawGroup.parse(value);
  const free = new Set(loose.map((t) => t.id));
  const taken = new Set(lib.clusters.map((c) => c.name.toLowerCase()));
  const out: NewShelf[] = [];
  for (const s of raw.shelves) {
    const name = shelfName(s.name);
    const bubbles = [...new Set(s.bubbles)].filter((id) => free.has(id));
    if (out.length >= MAX_NEW_SHELVES || !name || VAGUE.has(name) || taken.has(name) || bubbles.length < 2) continue;
    taken.add(name);
    for (const id of bubbles) free.delete(id);
    const reason = tidyText(s.reason ?? "", WHY_MAX);
    const holds = tidyText(s.holds ?? "", SHELF_ABOUT_MAX);
    out.push({ name, bubbles, ...(reason ? { reason } : {}), ...(holds ? { holds } : {}) });
  }
  return out;
}

// ---------- links ----------

export const LINK_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    connected: { type: "boolean" },
    word: { type: "string" },
    quote_a: { type: "string" },
    quote_b: { type: "string" },
  },
  required: ["reason", "connected", "word", "quote_a", "quote_b"],
  additionalProperties: false,
} as const;

export interface LinkCandidate {
  a: Thought;
  b: Thought;
  /** The name both bubbles mention. */
  shared: string;
}

/**
 * Pairs worth asking about: two bubbles on different shelves that both name the same person,
 * project or place. Rare names come first: they say more than a name that's everywhere.
 */
export function linkCandidates(
  lib: Library,
  cards: Map<number, Card>,
  names: readonly string[],
  skip: ReadonlySet<string> = new Set(),
): LinkCandidate[] {
  const mine = personThoughts(lib.thoughts);
  const linked = new Set(lib.links.map((l) => pairKey(l.a, l.b)));
  const all = new Map<string, string>();
  for (const n of names) all.set(nameKey(n), n);
  for (const c of cards.values()) for (const s of c.subjects) if (!all.has(nameKey(s))) all.set(nameKey(s), s);

  const groups = [...all.values()]
    .map((name) => ({ name, in: mine.filter((t) => mentions(name, t.body)) }))
    .filter((g) => g.in.length >= 2)
    .sort((x, y) => x.in.length - y.in.length);

  const out: LinkCandidate[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (let i = 0; i < g.in.length; i++) {
      for (let j = i + 1; j < g.in.length; j++) {
        const [a, b] = [g.in[i], g.in[j]];
        const key = pairKey(a.id, b.id);
        const together = a.clusterId !== null && a.clusterId === b.clusterId;
        if (together || linked.has(key) || skip.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push({ a, b, shared: g.name });
      }
    }
  }
  return out;
}

export function buildLinkUser(c: LinkCandidate): string {
  const lang = languageOf(c.a.body) ?? languageOf(c.b.body);
  return [
    `<bubble_a>\n${clip(c.a.body, BODY_SHOWN)}\n</bubble_a>`,
    `<bubble_b>\n${clip(c.b.body, BODY_SHOWN)}\n</bubble_b>`,
    `Both bubbles mention "${c.shared}". Is there a real connection between them that the person would be glad to see: the same person, project, plan or worry showing up in both?

- "reason": first, one sentence on what the two have in common, or why they don't.
- "connected": false when they only happen to share a word.
- "word": one or two lowercase words that name the connection${lang ? `, in ${lang}` : ""}. Empty when not connected.
- "quote_a", "quote_b": the exact words from each bubble that show it. Empty when not connected.`,
  ].join("\n\n");
}

const RawLink = z.object({
  connected: z.boolean().default(false),
  word: z.string().default(""),
  quote_a: z.string().default(""),
  quote_b: z.string().default(""),
});

/** The word for a link and the words that prove it, when the model can show the connection in both bubbles. */
export function parseLinkProof(value: unknown, c: LinkCandidate): { word: string; quotes: [string, string] } | null {
  const raw = RawLink.parse(value);
  const word = tidyText(raw.word, LINK_WORD_MAX).toLowerCase().split(" ").slice(0, 2).join(" ");
  if (!raw.connected || !word) return null;
  if (!grounded(raw.quote_a, c.a.body) || !grounded(raw.quote_b, c.b.body)) return null;
  return { word, quotes: [raw.quote_a.trim(), raw.quote_b.trim()] };
}

/** Just the word. */
export function parseLink(value: unknown, c: LinkCandidate): string | null {
  return parseLinkProof(value, c)?.word ?? null;
}

// ---------- doing it ----------

/** Moves a bubble for the bird, unless something changed since it decided. Returns whether it moved. */
function fileForBird(db: DB, t: Thought, clusterId: number | null, why: string | null = null): boolean {
  const moved = db
    .prepare(
      `UPDATE thoughts SET cluster_id = ?, placed_by = ?, why = ?
       WHERE id = ? AND source != 'bird' AND cluster_id IS ? AND (placed_by IS NULL OR placed_by = 'bird')`,
    )
    .run(clusterId, clusterId === null ? null : "bird", clusterId === null ? null : why, t.id, t.clusterId);
  return moved.changes > 0;
}

const memo = globalThis as unknown as { __birdLinkTried?: Set<string>; __birdLooseSeen?: Map<number, string> };

/** The shelves as they stand: a loose bubble is only asked about again once this changes. */
const shelfSignature = (lib: Library) =>
  shelvesOf(lib)
    .map((c) => `${c.id}:${c.name}:${lib.thoughts.filter((t) => t.clusterId === c.id).length}`)
    .join("|");

const place = async (lib: Library, cards: Map<number, Card>, knowledge: string, t: Thought) => {
  const user = buildPlaceUser(lib, cards, knowledge, t);
  const { value } = await askJson({ system: LIBRARIAN, user, schema: PLACE_SCHEMA, maxTokens: 220, temperature: 0.2 });
  return { target: parsePlace(value, lib), why: parseReason(value) };
};

function closingLine(steps: readonly TidyStep[], clusters: readonly Cluster[]): string | null {
  const name = (id: number | null) => clusters.find((c) => c.id === id)?.name;
  const shelf = steps.find((s) => s.kind === "shelf");
  if (shelf?.kind === "shelf") return `a new shelf: "${shelf.cluster.name}"`;
  const moved = steps.find((s) => s.kind === "file" && s.from !== null);
  if (moved?.kind === "file") {
    return moved.clusterId === null
      ? `that one didn't belong on "${name(moved.from) ?? "that shelf"}". i took it down`
      : `i read that one again. it belongs on "${name(moved.clusterId) ?? "another shelf"}"`;
  }
  const filed = steps.filter((s) => s.kind === "file");
  if (filed.length === 1 && filed[0].kind === "file") return `onto "${name(filed[0].clusterId) ?? "its shelf"}" it goes`;
  if (filed.length > 1) return `${filed.length} bubbles shelved. tidier`;
  const link = steps.find((s) => s.kind === "link");
  return link?.kind === "link" ? `those two share "${link.link.word}"` : null;
}

/** The bird tidies a little: a few decisions, each saved as it's made. Returns the steps to act out. */
export async function tidy(db: DB): Promise<TidyResult> {
  const started = Date.now();
  const inTime = () => Date.now() - started < BUDGET_MS;
  const knowledge = knowledgeText(db);
  const steps: TidyStep[] = [];
  const looseSeen = (memo.__birdLooseSeen ??= new Map());
  const tried = (memo.__birdLinkTried ??= new Set());

  // 1. Bubbles filed before they were read: look again, then loose ones.
  const first = getLibrary(db);
  const firstCards = getCards(db);
  const queue = [
    ...reviewable(first, firstCards).slice(0, MAX_REVIEWS),
    ...sortable(first.thoughts)
      .filter((t) => firstCards.has(t.id))
      .slice(-MAX_PLACEMENTS),
  ];
  for (const candidate of queue) {
    if (!inTime()) break;
    const lib = getLibrary(db);
    const t = lib.thoughts.find((x) => x.id === candidate.id);
    if (!t || t.clusterId !== candidate.clusterId || t.placedBy === "you") continue;
    const loose = t.clusterId === null;
    if (loose && shelvesOf(lib).length === 0) continue;
    const signature = shelfSignature(lib);
    if (loose && looseSeen.get(t.id) === signature) continue;
    const { target, why } = await place(lib, getCards(db), knowledge, t);
    if (target === t.clusterId) {
      if (loose) looseSeen.set(t.id, signature);
      else {
        markSorted(db, t.id);
        // It read the bubble properly this time: now it can say why it's there.
        if (why) db.prepare("UPDATE thoughts SET why = ? WHERE id = ? AND placed_by = 'bird' AND why IS NULL").run(why, t.id);
      }
      continue;
    }
    const moved = db.transaction(() => {
      if (!fileForBird(db, t, target, why)) return false;
      markSorted(db, t.id);
      pruneEmptyShelves(db);
      return true;
    })();
    if (!moved) continue;
    steps.push({ kind: "file", thoughtId: t.id, clusterId: target, from: t.clusterId });
  }

  // 2. Loose bubbles that fit nowhere: do some belong together on a new shelf?
  const lib2 = getLibrary(db);
  const cards2 = getCards(db);
  const stillLoose = sortable(lib2.thoughts).filter((t) => cards2.has(t.id));
  const groupKey = stillLoose.map((t) => t.id).join(",");
  if (stillLoose.length >= 2 && inTime() && !tried.has(`group:${groupKey}`)) {
    tried.add(`group:${groupKey}`);
    const user = buildGroupUser(lib2, cards2, knowledge, stillLoose.slice(-12));
    const { value } = await askJson({ system: LIBRARIAN, user, schema: GROUP_SCHEMA, maxTokens: 400, temperature: 0.2 });
    for (const g of parseGroups(value, lib2, stillLoose)) {
      db.transaction(() => {
        const shelf = createShelf(db, g.name);
        const filed = stillLoose.filter((t) => g.bubbles.includes(t.id) && fileForBird(db, t, shelf.id, g.reason ?? null));
        if (filed.length === 0) return;
        if (g.holds) describeShelf(db, shelf.id, g.holds, filed.length);
        steps.push({ kind: "shelf", cluster: shelf });
        for (const t of filed) {
          markSorted(db, t.id);
          steps.push({ kind: "file", thoughtId: t.id, clusterId: shelf.id, from: null });
        }
      })();
    }
    pruneEmptyShelves(db);
  }

  // 3. Links between bubbles on different shelves that name the same thing.
  const lib3 = getLibrary(db);
  const names = listFacts(db).flatMap((f) => (f.name ? [f.name] : []));
  // Never a pair it already asked about, or one whose link you popped.
  const skip = new Set([...tried, ...poppedPairs(db)]);
  for (const c of linkCandidates(lib3, getCards(db), names, skip).slice(0, MAX_LINK_TRIES)) {
    if (!inTime()) break;
    tried.add(pairKey(c.a.id, c.b.id));
    const { value } = await askJson({
      system: LIBRARIAN,
      user: buildLinkUser(c),
      schema: LINK_SCHEMA,
      maxTokens: 260,
      temperature: 0.2,
    });
    const proof = parseLinkProof(value, c);
    const link = proof ? addLink(db, c.a.id, c.b.id, proof.word, proof.quotes) : null;
    if (link) steps.push({ kind: "link", link });
  }

  return { steps, line: closingLine(steps, getLibrary(db).clusters.concat(first.clusters)) };
}
