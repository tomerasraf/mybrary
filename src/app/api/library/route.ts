import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getLibrary } from "@/lib/library";

export const runtime = "nodejs";

/** The whole library as saved: the world re-syncs with it after anything that may have drifted. */
export function GET(): Response {
  return ok(getLibrary(getDb()));
}
