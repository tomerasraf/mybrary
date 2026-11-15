import { fail, ok, zodMessage } from "@/lib/api";
import { Question, askBird } from "@/lib/ai/ask";
import { friendlyBrainError } from "@/lib/ai/llm";
import { BusyError, oneAtATime } from "@/lib/ai/queue";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/** You ask the bird about your own bubbles. It answers from them, and says which ones. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Question.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    return ok(await oneAtATime(() => askBird(getDb(), parsed.data.question)));
  } catch (error) {
    if (error instanceof BusyError) return fail("The bird is busy with something. Ask again in a moment.", 429);
    console.error("[bird] ask failed", error);
    return fail(friendlyBrainError(error), 502);
  }
}
