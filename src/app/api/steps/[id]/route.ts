import { fail, ok, parseId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { StepPatch, closeStep, snoozeStep } from "@/lib/steps";

export const runtime = "nodejs";

/** You did a step, waved it away, or put it off for a few days. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseId((await ctx.params).id);
  const patch = StepPatch.safeParse(await req.json().catch(() => null));
  if (id === null || !patch.success) return fail("That didn't look right.");
  const step = patch.data.status === "later" ? snoozeStep(getDb(), id) : closeStep(getDb(), id, patch.data.status);
  return step ? ok(step) : fail("That step is already gone.", 404);
}
