import { z } from "zod";
import { fail, ok, parseId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { MoveError, moveThought, removeThought } from "@/lib/library";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Move = z.object({ clusterId: z.number().int().positive().nullable() });

/** You moved a bubble onto a shelf, or back onto the floor (clusterId null). */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("Unknown thought.", 404);
  const parsed = Move.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("That move didn't make sense.");
  try {
    return ok(moveThought(getDb(), id, parsed.data.clusterId, "you"));
  } catch (error) {
    if (error instanceof MoveError) return fail(error.message, 409);
    console.error("[thoughts] move failed", error);
    return fail("Couldn't move that bubble. Try again.", 500);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("Unknown thought.", 404);
  return removeThought(getDb(), id) ? ok({ id }) : fail("That bubble is already gone.", 404);
}
