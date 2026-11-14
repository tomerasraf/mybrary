import { ok } from "@/lib/api";
import { warmUp } from "@/lib/ai/llm";

export const runtime = "nodejs";

/** Loads the local model when the page opens, so the bird's first thought comes quickly. */
export async function POST(): Promise<Response> {
  return ok({ awake: await warmUp() });
}
