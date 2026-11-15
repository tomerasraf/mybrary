import { fail, ok } from "@/lib/api";
import { friendlyBrainError } from "@/lib/ai/llm";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { suggestStep } from "@/lib/ai/suggest";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/** The bird suggests one small thing to do about a shelf. Null when it has nothing worth saying. */
export async function POST(): Promise<Response> {
  const db = getDb();
  try {
    return ok(await oneAtATime(() => suggestStep(db)));
  } catch (error) {
    if (error instanceof BusyError) return fail(error.message, 429);
    console.error("[bird] step failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
