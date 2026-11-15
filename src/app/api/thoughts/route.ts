import { ZodError } from "zod";
import { fail, ok, zodMessage } from "@/lib/api";
import { getDb } from "@/lib/db";
import { startReading } from "@/lib/ai/read";
import { createThought, listThoughts } from "@/lib/thoughts";

export const runtime = "nodejs";

const READ_AFTER_MS = 20_000;

export function GET(): Response {
  return ok(listThoughts(getDb()));
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  try {
    const thought = createThought(getDb(), body ?? {});
    // The bird reads it properly in a moment, after it has watched the bubble float up.
    startReading(getDb(), READ_AFTER_MS);
    return ok(thought, 201);
  } catch (error) {
    if (error instanceof ZodError) return fail(zodMessage(error));
    console.error("[thoughts] create failed", error);
    return fail("Couldn't save that thought. Try again.", 500);
  }
}
