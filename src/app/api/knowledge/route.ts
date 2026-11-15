import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listFacts, listRules } from "@/lib/knowledge";

export const runtime = "nodejs";

/** What the bird knows for sure: facts from your bubbles, and things you told it to do. */
export function GET(): Response {
  const db = getDb();
  return ok([...listRules(db), ...listFacts(db)]);
}
