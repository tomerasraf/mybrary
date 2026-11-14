import { fail, ok, parseId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deleteThought } from "@/lib/thoughts";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("Unknown thought.", 404);
  return deleteThought(getDb(), id) ? ok({ id }) : fail("That bubble is already gone.", 404);
}
