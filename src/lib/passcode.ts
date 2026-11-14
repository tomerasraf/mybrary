// Edge-safe helpers (Web Crypto only) for the optional APP_PASSCODE lock.
export const AUTH_COOKIE = "timeflow_key";

export async function passcodeToken(passcode: string): Promise<string> {
  const data = new TextEncoder().encode(`timeflow:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
