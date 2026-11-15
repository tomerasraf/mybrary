import { fail, ok, parseId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { removeLink } from "@/lib/library";

export const runtime = "nodejs";

/** Pop a link you don't agree with. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("Unknown link.", 404);
  return removeLink(getDb(), id) ? ok({ id }) : fail("That link is already gone.", 404);
}
