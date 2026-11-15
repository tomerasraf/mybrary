import { fail, ok, parseId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { forgetFact } from "@/lib/knowledge";

export const runtime = "nodejs";

/** Makes the bird forget something it got wrong. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("That didn't look right.");
  return forgetFact(getDb(), id) ? ok({ id }) : fail("The bird already forgot that.", 404);
}
