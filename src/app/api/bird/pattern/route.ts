import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { nextPattern } from "@/lib/patterns";

export const runtime = "nodejs";

/** Something that keeps coming back in your bubbles, if there's one the bird hasn't pointed out yet. */
export function POST(): Response {
  const next = nextPattern(getDb());
  return ok(next ? { line: next.line, ids: next.ids } : null);
}
