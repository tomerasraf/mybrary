import { z } from "zod";

export const runtime = "nodejs";

/**
 * Place search via OpenStreetMap Nominatim, biased to Gush Dan.
 * Nominatim's usage policy: max 1 request/second and an identifying User-Agent.
 */
const Query = z.string().trim().min(2).max(120);
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const GUSH_DAN_VIEWBOX = "34.70,32.20,34.98,31.95"; // left,top,right,bottom
const MIN_INTERVAL_MS = 1100;
const CACHE_LIMIT = 200;

interface Result {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

const SEARCH_DOWN = "Map search is unavailable right now. Tap the map to drop a pin instead.";
const cache = new Map<string, readonly Result[]>();
const inFlight = new Map<string, Promise<readonly Result[] | null>>();
let lastCall = 0;

const NominatimHit = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  name: z.string().optional(),
});

export async function GET(req: Request): Promise<Response> {
  const parsed = Query.safeParse(new URL(req.url).searchParams.get("q"));
  if (!parsed.success) return Response.json({ success: false, error: "Type at least 2 characters." }, { status: 400 });
  const q = parsed.data.toLowerCase();

  const cached = cache.get(q);
  if (cached) return Response.json({ success: true, data: cached });

  // Identical searches already in flight share one upstream call.
  let request = inFlight.get(q);
  if (!request) {
    request = lookup(parsed.data, q).finally(() => inFlight.delete(q));
    inFlight.set(q, request);
  }
  const results = await request;
  return results
    ? Response.json({ success: true, data: results })
    : Response.json({ success: false, error: SEARCH_DOWN }, { status: 502 });
}

/** Reserves the next 1-second slot before waiting, so concurrent calls never overlap. */
async function waitForSlot(): Promise<void> {
  const slot = Math.max(Date.now(), lastCall + MIN_INTERVAL_MS);
  lastCall = slot;
  const wait = slot - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function lookup(query: string, key: string): Promise<readonly Result[] | null> {
  await waitForSlot();
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("viewbox", GUSH_DAN_VIEWBOX);
  url.searchParams.set("countrycodes", "il");
  url.searchParams.set("accept-language", "en,he");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TimeFlow-personal-app/0.2 (self-hosted, single user)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const hits = z.array(NominatimHit).parse(await res.json());
    const results: Result[] = hits.map((h) => ({
      name: h.name || h.display_name.split(",")[0],
      address: h.display_name.split(",").slice(1, 4).join(",").trim(),
      lat: Number(h.lat),
      lng: Number(h.lon),
    }));
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, results);
    return results;
  } catch (error) {
    console.error("[geocode] failed", error);
    return null;
  }
}
