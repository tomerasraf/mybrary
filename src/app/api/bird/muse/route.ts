import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { MUSE_MIN_BUBBLES, muse } from "@/lib/ai/muse";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { getDb } from "@/lib/db";
import { listThoughts } from "@/lib/thoughts";
import { personThoughts } from "@/lib/library";

export const runtime = "nodejs";

/** The bird writes one of its own thoughts about the library, into its nook. */
export async function POST(): Promise<Response> {
  const db = getDb();
  if (personThoughts(listThoughts(db)).length < MUSE_MIN_BUBBLES) return fail("The bird needs a few more bubbles first.", 409);
  try {
    return ok(await oneAtATime(() => muse(db)), 201);
  } catch (error) {
    if (error instanceof BusyError) return fail(error.message, 429);
    console.error("[bird] muse failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
