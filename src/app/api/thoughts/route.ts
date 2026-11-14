import { ZodError } from "zod";
import { fail, ok, zodMessage } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createThought, listThoughts } from "@/lib/thoughts";

export const runtime = "nodejs";

export function GET(): Response {
  return ok(listThoughts(getDb()));
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  try {
    return ok(createThought(getDb(), body ?? {}), 201);
  } catch (error) {
    if (error instanceof ZodError) return fail(zodMessage(error));
    console.error("[thoughts] create failed", error);
    return fail("Couldn't save that thought. Try again.", 500);
  }
}
