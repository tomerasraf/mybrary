import { z } from "zod";
import type { DB } from "../db";
import { BIRD_THOUGHT_MAX, birdThoughts, createBirdThought, getLibrary, personThoughts, type Library } from "../library";
import { recentNotes } from "../notebook";
import type { Thought } from "../thoughts";
import { askJson } from "./llm";
import { tooSimilar } from "./ponder";
import { LIBRARIAN, majorityLanguage } from "./tidy";

// The bird writes its own thoughts about its library, into its nook, for the person to come and read.

const TASK = `Write one new thought for your own shelf, "the bird's thoughts". The person will come and read it later.

Think about everything you see in your library right now: the shelves and what's on them, what's piling up, what's still loose, the links, what keeps coming back, what looks ready for them to do something about.
- 1 to 3 short sentences, at most 50 words. Lowercase. Your voice: a small, curious, warm, slightly silly librarian bird. Not a therapist, no advice lists, no emoji.
- Be specific: name shelves and echo the bubbles' own words.
- Your library is all you know. Only talk about what is in it.
- Say something new. Never repeat an idea from <your_shelf>, and start it differently than those do.
- When you have one, end with what you'd do about it, or one small idea for them.`;

export const MUSE_SCHEMA = {
  type: "object",
  properties: { thought: { type: "string" } },
  required: ["thought"],
  additionalProperties: false,
} as const;

const MAX_BUBBLES = 45;
const MAX_OWN = 8;
const PREVIEW = 120;

const clip = (t: string, max: number) => {
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/** Ways of looking at the library, so the bird's thoughts don't all circle the same idea. */
export const ANGLES = {
  biggest: "Look at your biggest shelf: what's piling up there, and what one small step would make it lighter?",
  loose: "Look at the bubbles still floating loose: what might they be about, together or apart?",
  link: "Look at one of the links: what does that connection say about the person?",
  ready: "Find one bubble that looks ready to act on this week, and say why it's ready.",
  newest: "Look at the newest bubbles: what changed lately in the person's mind?",
  pair: "Find two shelves that might be about the same thing underneath.",
  quiet: "Find a shelf that's gone quiet (no new bubbles for a while) and wonder about it.",
} as const;
export type Angle = keyof typeof ANGLES;

/** The angles that make sense for this library. */
export function anglesFor(lib: Library): Angle[] {
  const mine = personThoughts(lib.thoughts);
  const shelves = lib.clusters.filter((c) => c.kind === "shelf");
  const out: Angle[] = ["ready", "newest"];
  if (shelves.length > 0) out.push("biggest");
  if (shelves.length > 1) out.push("pair", "quiet");
  if (mine.some((t) => t.clusterId === null)) out.push("loose");
  if (lib.links.length > 0) out.push("link");
  return out;
}

/** The bird needs a few bubbles before it has anything to think about. */
export const MUSE_MIN_BUBBLES = 3;

export function buildMuseUser(
  lib: Library,
  own: readonly Thought[],
  notebook: readonly string[],
  angle: Angle = "ready",
): string {
  const mine = personThoughts(lib.thoughts).slice(-MAX_BUBBLES);
  const byId = new Map(mine.map((t) => [t.id, t]));
  // No ids here: the bird is writing for a person, and small models would quote them.
  const line = (t: Thought) => `- ${clip(t.body, PREVIEW)}`;
  const shelves = lib.clusters
    .filter((c) => c.kind === "shelf")
    .map((c) => {
      const on = mine.filter((t) => t.clusterId === c.id);
      return `<shelf name="${c.name}" bubbles="${on.length}">\n${on.map(line).join("\n")}\n</shelf>`;
    });
  const loose = mine.filter((t) => t.clusterId === null);
  const links = lib.links
    .filter((l) => byId.has(l.a) && byId.has(l.b))
    .map((l) => `- "${clip(byId.get(l.a)!.body, 60)}" and "${clip(byId.get(l.b)!.body, 60)}": ${l.word}`);

  const parts = [
    `<notebook>\n${notebook.length ? notebook.map((n) => `- ${n}`).join("\n") : "(empty)"}\n</notebook>`,
    `<your_shelf>\n${own.length ? own.map((t) => `- ${clip(t.body, 300)}`).join("\n") : "(nothing yet: this is your first thought)"}\n</your_shelf>`,
    `<shelves>\n${shelves.length ? shelves.join("\n") : "(no shelves yet)"}\n</shelves>`,
    `<loose>\n${loose.length ? loose.map(line).join("\n") : "(none)"}\n</loose>`,
    `<links>\n${links.length ? links.join("\n") : "(none)"}\n</links>`,
  ];
  const lang = majorityLanguage(mine);
  parts.push(`${TASK}\n- Write it in ${lang ?? "the language most of the bubbles are written in"}.`);
  parts.push(`This time: ${ANGLES[angle]}`);
  return parts.join("\n\n");
}

const Raw = z.object({ thought: z.string() });

/** The model's thought, cleaned up, or a reason it can't be used. */
export function parseMuse(value: unknown, own: readonly Thought[]): { text: string } | { problem: string } {
  const text = Raw.parse(value)
    .thought.trim()
    // Small models sometimes label it ("the bird's thoughts: …").
    .replace(/^[^:\n]{0,30}thoughts?\s*:\s*/i, "")
    .replace(/^["“']|["”']$/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, BIRD_THOUGHT_MAX);
  if (!text) return { problem: "the thought was empty" };
  const repeat = own.find((t) => tooSimilar(t.body, text));
  if (repeat) return { problem: `you already wrote almost the same thing ("${clip(repeat.body, 120)}"); think of something new` };
  return { text };
}

/** The bird thinks about its library and writes a thought into its nook. */
export async function muse(db: DB): Promise<Thought> {
  const lib = getLibrary(db);
  const own = birdThoughts(db, MAX_OWN);
  const angles = anglesFor(lib);
  const angle = angles[Math.floor(Math.random() * angles.length)];
  const notebook = recentNotes(db, "note", 20).map((n) => n.body);
  const user = buildMuseUser(lib, own, notebook, angle);
  const ask = async (extra: string) => {
    const { value } = await askJson({ system: LIBRARIAN, user: user + extra, schema: MUSE_SCHEMA, maxTokens: 400 });
    return parseMuse(value, own);
  };
  let result = await ask("");
  if ("problem" in result) result = await ask(`\n\nYour first try had a problem: ${result.problem}. Try again.`);
  if ("problem" in result) throw new Error(`the bird's thought didn't work out: ${result.problem}`);
  return createBirdThought(db, result.text);
}
