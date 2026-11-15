import { z } from "zod";
import type { DB } from "./db";

// Small things the bird suggests you do, each taken from one of your bubbles.
// You tick them off or wave them away; the bird never piles up more than a few.

export type StepStatus = "open" | "done" | "dismissed";

export interface Step {
  id: number;
  body: string;
  /** The bubble it came from. */
  thoughtId: number | null;
  /** The shelf it's about. */
  clusterId: number | null;
  status: StepStatus;
  createdAt: string;
  closedAt: string | null;
  /** Put off until then; it stays off the note meanwhile. */
  snoozeUntil?: string | null;
}

export const STEP_MAX = 120;
/** The bird stops suggesting when this many are still waiting for you. */
export const MAX_OPEN_STEPS = 3;

/** How long "later" puts a step off for. */
export const LATER_DAYS = 3;

export const StepPatch = z.object({ status: z.enum(["done", "dismissed", "later"]) });

interface Row {
  id: number;
  body: string;
  thought_id: number | null;
  cluster_id: number | null;
  status: string;
  created_at: string;
  closed_at: string | null;
  snooze_until?: string | null;
}

const toStep = (r: Row): Step => ({
  id: r.id,
  body: r.body,
  thoughtId: r.thought_id,
  clusterId: r.cluster_id,
  status: r.status === "done" || r.status === "dismissed" ? r.status : "open",
  createdAt: r.created_at,
  closedAt: r.closed_at,
  snoozeUntil: r.snooze_until ?? null,
});

/** Steps waiting for you now. Ones you put off stay away until their time comes. */
export function openSteps(db: DB, now: Date = new Date()): Step[] {
  const rows = db
    .prepare("SELECT * FROM steps WHERE status = 'open' AND (snooze_until IS NULL OR snooze_until <= ?) ORDER BY id ASC")
    .all(now.toISOString()) as Row[];
  return rows.map(toStep);
}

/** Not now: the step leaves the note and comes back in a few days. Null if it isn't open any more. */
export function snoozeStep(db: DB, id: number, now: Date = new Date(), days = LATER_DAYS): Step | null {
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare("UPDATE steps SET snooze_until = ? WHERE id = ? AND status = 'open' RETURNING *").get(until, id) as
    | Row
    | undefined;
  return row ? toStep(row) : null;
}

/** The latest steps, whatever became of them, oldest first. */
export function recentSteps(db: DB, limit: number): Step[] {
  const rows = db.prepare("SELECT * FROM (SELECT * FROM steps ORDER BY id DESC LIMIT ?) ORDER BY id ASC").all(limit) as Row[];
  return rows.map(toStep);
}

export function addStep(db: DB, body: string, thoughtId: number, clusterId: number | null): Step {
  const text = body.replace(/\s+/g, " ").trim().slice(0, STEP_MAX).trim();
  if (!text) throw new Error("the step is empty");
  const row = db
    .prepare("INSERT INTO steps (body, thought_id, cluster_id) VALUES (?, ?, ?) RETURNING *")
    .get(text, thoughtId, clusterId) as Row;
  return toStep(row);
}

/** You did it, or you don't want it. Returns the step, or null if it isn't open any more. */
export function closeStep(db: DB, id: number, status: "done" | "dismissed"): Step | null {
  const row = db
    .prepare(
      "UPDATE steps SET status = ?, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'open' RETURNING *",
    )
    .get(status, id) as Row | undefined;
  return row ? toStep(row) : null;
}
