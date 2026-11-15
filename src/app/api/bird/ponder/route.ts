import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { RepeatError, ponder } from "@/lib/ai/ponder";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { getDb } from "@/lib/db";
import { personThoughts } from "@/lib/library";
import { addNote, recentNotes } from "@/lib/notebook";
import { getThought, listThoughts } from "@/lib/thoughts";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new"), id: z.number().int().positive() }),
  z.object({ mode: z.literal("wander"), avoid: z.array(z.number().int()).max(20).default([]) }),
]);

const MAX_BUBBLES = 50;
const NOTEBOOK_PAGES = 25;
const SAID_LINES = 12;

export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("The bird didn't understand that.");

  const db = getDb();
  const focus = parsed.data.mode === "new" ? getThought(db, parsed.data.id) : undefined;
  if (focus === null || focus?.source === "bird") return fail("That bubble is gone.", 404);
  if (personThoughts(listThoughts(db)).length === 0) return fail("There are no bubbles yet.", 404);

  try {
    return await oneAtATime(async () => {
      const bubbles = personThoughts(listThoughts(db)).slice(-MAX_BUBBLES);
      const result = await ponder({
        mode: parsed.data.mode,
        focus,
        bubbles,
        avoid: parsed.data.mode === "wander" ? parsed.data.avoid : [],
        notes: recentNotes(db, "note", NOTEBOOK_PAGES),
        said: recentNotes(db, "said", SAID_LINES),
      });
      addNote(db, "said", result.line, result.id);
      if (result.note) addNote(db, "note", result.note, result.id);
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
