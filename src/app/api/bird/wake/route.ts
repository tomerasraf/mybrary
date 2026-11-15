import { ok } from "@/lib/api";
import { warmUp } from "@/lib/ai/llm";
import { startReading } from "@/lib/ai/read";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/** Loads the local model when the page opens, so the bird's first thought comes quickly. */
export async function POST(): Promise<Response> {
  const awake = await warmUp();
  // Catch up on any bubbles the bird hasn't read yet.
  if (awake) startReading(getDb());
  return ok({ awake });
}
