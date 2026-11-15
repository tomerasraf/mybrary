import { ok } from "@/lib/api";
import { nextAged } from "@/lib/aging";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/** An old bubble the bird wants to ask about, if there is one. */
export function POST(): Response {
  const next = nextAged(getDb());
  return ok(next ? { id: next.thought.id, line: next.line } : null);
}
