import { fail, ok, zodMessage } from "@/lib/api";
import { getDb } from "@/lib/db";
import { Feedback, takeFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

/** You wave a question away, or tell the bird something just for it. No bubble is made. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Feedback.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    takeFeedback(getDb(), parsed.data);
    return ok({ kind: parsed.data.kind });
  } catch (error) {
    console.error("[bird] feedback failed", error);
    return fail("The bird couldn't keep that. Try again.", 500);
  }
}
