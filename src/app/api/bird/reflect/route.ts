import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { reflect } from "@/lib/ai/reflect";
import { getCards } from "@/lib/cards";
import { getDb } from "@/lib/db";
import { knowledgeText } from "@/lib/knowledge";
import { personThoughts } from "@/lib/library";
import { addNote, recentNotes } from "@/lib/notebook";
import { getPage } from "@/lib/page";
import { getThought, listThoughts } from "@/lib/thoughts";

export const runtime = "nodejs";

const Body = z.object({ id: z.number().int().positive() });

/** Earlier thoughts the bird keeps in view, in short. */
const EARLIER_SHOWN = 14;
const EARLIER_CLIP = 240;
/** Its own recent questions, so it doesn't ask the same thing twice. */
const ASKED_SHOWN = 8;
const WAVED_SHOWN = 10;

/** A thought was just born: the bird asks its one question about it, or stays quiet (null). */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("The bird didn't understand that.");

  const db = getDb();
  const focus = getThought(db, parsed.data.id);
  if (!focus || focus.source === "bird") return fail("That bubble is gone.", 404);

  try {
    return await oneAtATime(async () => {
      const cards = getCards(db);
      const earlier = personThoughts(listThoughts(db))
        .filter((t) => t.id !== focus.id)
        .slice(-EARLIER_SHOWN)
        .map((t) => ({ date: t.createdAt.slice(0, 10), gist: cards.get(t.id)?.gist ?? t.body.slice(0, EARLIER_CLIP) }));
      const result = await reflect({
        focus,
        earlier,
        page: getPage(db).lines.map((l) => `${l.thing}: ${l.now}`),
        knowledge: knowledgeText(db),
        asked: recentNotes(db, "said", ASKED_SHOWN)
          .map((n) => n.body)
          .filter((line) => line.endsWith("?")),
        waved: recentNotes(db, "waved", WAVED_SHOWN).map((n) => n.body),
      });
      if (result.question) addNote(db, "said", result.question, focus.id);
      return ok({ question: result.question });
    });
  } catch (error) {
    if (error instanceof BusyError) return fail(error.message, 429);
    console.error("[bird] reflect failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
