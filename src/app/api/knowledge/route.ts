import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listFacts, listRules, type Fact } from "@/lib/knowledge";
import { recentNotes } from "@/lib/notebook";

export const runtime = "nodejs";

const WAVED_SHOWN = 12;

/** What the bird knows for sure: things you told it, facts from your bubbles, and questions you waved away. */
export function GET(): Response {
  const db = getDb();
  const waved: Fact[] = recentNotes(db, "waved", WAVED_SHOWN).map((n) => ({ id: n.id, kind: "waved", name: null, body: n.body, thoughtId: null }));
  return ok([...listRules(db), ...listFacts(db), ...waved]);
}
