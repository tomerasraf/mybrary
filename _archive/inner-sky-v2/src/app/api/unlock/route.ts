import { z } from "zod";
import { AUTH_COOKIE, passcodeToken, safeEqual } from "@/lib/passcode";

export const runtime = "nodejs";

const Body = z.object({ passcode: z.string().min(1).max(200) });
const ONE_YEAR = 60 * 60 * 24 * 365;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

// Single-user app: one global counter is enough, and it also covers guesses sent in parallel.
let failures = 0;
let lockedUntil = 0;

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return Response.json({ success: true });

  if (Date.now() < lockedUntil) {
    return Response.json({ success: false, error: "Too many wrong tries. Wait 10 minutes." }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  const ok = parsed.success && safeEqual(await passcodeToken(parsed.data.passcode), await passcodeToken(expected));
  if (!ok) {
    failures += 1;
    if (failures >= MAX_FAILURES) {
      failures = 0;
      lockedUntil = Date.now() + LOCKOUT_MS;
    }
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ success: false, error: "That's not it." }, { status: 401 });
  }

  failures = 0;
  const token = await passcodeToken(expected);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR}${secure}`,
    },
  });
}
