import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { RepeatError, ponder } from "@/lib/ai/ponder";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { getCards } from "@/lib/cards";
import { getDb } from "@/lib/db";
import { knowledgeText } from "@/lib/knowledge";
import { personThoughts } from "@/lib/library";
import { addNote, recentNotes } from "@/lib/notebook";
import { getThought, listThoughts, type Thought } from "@/lib/thoughts";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new"), id: z.number().int().positive() }),
  z.object({ mode: z.literal("wander"), avoid: z.array(z.number().int()).max(20).default([]) }),
]);

const MAX_BUBBLES = 50;
const SAID_LINES = 12;
/** How many of its last lines count as "talked about that one lately". */
const RECENTLY = 4;
/** How many waved-away questions the bird keeps in mind. */
const WAVED_LINES = 10;

/** The bubble the bird walks over to: one it hasn't looked at or talked about lately. */
function pickBubble(bubbles: Thought[], avoid: number[], talkedAbout: (number | null)[]): Thought | undefined {
  const fresh = bubbles.filter((t) => !avoid.includes(t.id) && !talkedAbout.includes(t.id));
  const fine = bubbles.filter((t) => !avoid.includes(t.id));
  const pool = fresh.length ? fresh : fine.length ? fine : bubbles;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("The bird didn't understand that.");
  const request = parsed.data;

  const db = getDb();
  const born = request.mode === "new" ? getThought(db, request.id) : undefined;
  if (born === null || born?.source === "bird") return fail("That bubble is gone.", 404);
  if (personThoughts(listThoughts(db)).length === 0) return fail("There are no bubbles yet.", 404);

  try {
    return await oneAtATime(async () => {
      const bubbles = personThoughts(listThoughts(db)).slice(-MAX_BUBBLES);
      const said = recentNotes(db, "said", SAID_LINES);
      const lately = said.slice(-RECENTLY).map((n) => n.thoughtId);
      const focus = born ?? pickBubble(bubbles, request.mode === "wander" ? request.avoid : [], lately);
      if (!focus) return fail("There are no bubbles yet.", 404);
      const result = await ponder({ mode: request.mode, focus, bubbles, cards: getCards(db), knowledge: knowledgeText(db),
        said,
        waved: recentNotes(db, "waved", WAVED_LINES).map((n) => n.body),
      });
      addNote(db, "said", result.line, result.id);
      return ok({ id: result.id, line: result.line, links: result.links });
    });
  } catch (error) {
    if (error instanceof BusyError) return fail(error.message, 429);
    // Nothing new to say isn't a failure: the bird just looks quietly this time.
    if (error instanceof RepeatError) return ok(null);
    console.error("[bird] ponder failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
