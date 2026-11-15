import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { startReading, waitingToBeRead } from "@/lib/ai/read";
import { hasWork, tidy } from "@/lib/ai/tidy";
import { getDb } from "@/lib/db";
import { getLibrary, type TidyResult } from "@/lib/library";

export const runtime = "nodejs";

/** The bird tidies its library a little: files loose bubbles, makes shelves, links bubbles. */
export async function POST(): Promise<Response> {
  const db = getDb();
  // The bird sorts from what it has read: make sure it's reading whatever is new.
  startReading(db);
  const reading = waitingToBeRead(db).length > 0;
  if (!hasWork(db, getLibrary(db))) return ok({ steps: [], line: null, reading } satisfies TidyResult);
  try {
    const result = await oneAtATime(() => tidy(db));
    return ok({ ...result, reading: waitingToBeRead(db).length > 0 } satisfies TidyResult);
  } catch (error) {
    if (error instanceof BusyError) return fail(error.message, 429);
    console.error("[bird] tidy failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
