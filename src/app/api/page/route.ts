import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getPage, unsettled, type MindPage } from "@/lib/page";

export const runtime = "nodejs";

export interface PageState {
  page: MindPage;
  /** Ids of the thoughts the bird hasn't taken into the page yet: these still float. */
  floating: number[];
}

/** The bird's page as it stands, and which bubbles are still waiting to go into it. */
export function GET(): Response {
  const db = getDb();
  return ok({ page: getPage(db), floating: unsettled(db).map((t) => t.id) } satisfies PageState);
}
