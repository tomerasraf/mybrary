import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { hasWork, tidy } from "@/lib/ai/tidy";
import { getDb } from "@/lib/db";
import { getLibrary, type TidyResult } from "@/lib/library";

export const runtime = "nodejs";

/** The bird tidies its library a little: files loose bubbles, makes shelves, links bubbles. */
export async function POST(): Promise<Response> {
  const db = getDb();
  if (!hasWork(getLibrary(db))) return ok({ steps: [], line: null } satisfies TidyResult);
  try {
    // Read the library again inside the queue: it may have changed while waiting.
    return ok(await oneAtATime(() => tidy(db, getLibrary(db))));
  } catch (error) {
    if (error instanceof BusyError) return fail(error.message, 429);
    console.error("[bird] tidy failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
