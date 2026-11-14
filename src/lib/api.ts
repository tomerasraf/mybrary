import { ZodError } from "zod";

export type ApiResult<T> = { success: true; data: T; error: null } | { success: false; data: null; error: string };

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ success: true, data, error: null } satisfies ApiResult<T>, { status });
}

export function fail(error: string, status = 400): Response {
  return Response.json({ success: false, data: null, error } satisfies ApiResult<never>, { status });
}

export function zodMessage(error: ZodError): string {
  return error.issues[0]?.message ?? "That didn't look right.";
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
