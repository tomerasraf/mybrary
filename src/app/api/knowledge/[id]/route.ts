import { z } from "zod";
import { fail, ok, parseId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { FACT_BODY_MAX, RULE_MAX, editFact, forgetFact } from "@/lib/knowledge";
import { removeNote } from "@/lib/notebook";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const Edit = z.object({ body: z.string().trim().min(1).max(Math.max(FACT_BODY_MAX, RULE_MAX)) });

/** You correct something the bird knows. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const id = parseId((await ctx.params).id);
  const parsed = Edit.safeParse(await req.json().catch(() => null));
  if (id === null || !parsed.success) return fail("That didn't look right.");
  const fact = editFact(getDb(), id, parsed.data.body);
  return fact ? ok(fact) : fail("The bird already forgot that.", 404);
}

/** Makes the bird forget something it got wrong. `?kind=waved`: it may ask that question again. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail("That didn't look right.");
  const waved = new URL(req.url).searchParams.get("kind") === "waved";
  const gone = waved ? removeNote(getDb(), "waved", id) : forgetFact(getDb(), id);
  return gone ? ok({ id }) : fail("The bird already forgot that.", 404);
}
