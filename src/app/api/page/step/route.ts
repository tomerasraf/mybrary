import { fail, ok, zodMessage } from "@/lib/api";
import { getDb } from "@/lib/db";
import { StepAnswer, answerStep } from "@/lib/page";

export const runtime = "nodejs";

/** You did the small step on the page, or it isn't for you. Either way it leaves the page. */
export async function POST(req: Request): Promise<Response> {
  const parsed = StepAnswer.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    return ok(answerStep(getDb(), parsed.data.status));
  } catch (error) {
    console.error("[page] step failed", error);
    return fail("Couldn't change the page. Try again.", 500);
  }
}
