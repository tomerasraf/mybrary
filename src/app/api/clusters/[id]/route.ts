import { ZodError } from "zod";
import { fail, ok, parseId, zodMessage } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getCluster, updateShelf } from "@/lib/library";

export const runtime = "nodejs";

/** Rename or recolour a shelf. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("Unknown shelf.", 404);
  const db = getDb();
  if (getCluster(db, id)?.kind !== "shelf") return fail("That shelf is gone.", 404);
  try {
    const shelf = updateShelf(db, id, (await req.json().catch(() => null)) ?? {});
    return shelf ? ok(shelf) : fail("That shelf is gone.", 404);
  } catch (error) {
    if (error instanceof ZodError) return fail(zodMessage(error));
    console.error("[clusters] update failed", error);
    return fail("Couldn't change that shelf. Try again.", 500);
  }
}
