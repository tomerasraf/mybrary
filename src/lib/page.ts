import { z } from "zod";
import type { DB } from "./db";
import type { Library } from "./library";
import { addNote } from "./notebook";
import { toThought, type Thought, type ThoughtRow } from "./thoughts";

// The one page the bird keeps for you: what's on your mind right now, and at most one small step.
// You talk, the bird takes each thought into the page, and the bubble floats away. You never have
// to read your thoughts again: the page is all there is to look at.

export interface PageLine {
  /** The thing itself, in your own name for it: a project, a person, a choice. */
  thing: string;
  /** Where it stands right now. */
  now: string;
}

export interface MindPage {
  /** What's on your mind, a line each. */
  lines: PageLine[];
  /** One small thing you could do next, or null. */
  step: string | null;
  /** Null when the bird hasn't written the page yet. */
  updatedAt: string | null;
}

export const PAGE_LINES_MAX = 5;
export const PAGE_THING_MAX = 40;
export const PAGE_LINE_MAX = 150;
export const PAGE_STEP_MAX = 140;

export const StepAnswer = z.object({ status: z.enum(["done", "dismissed"]) });

interface Row {
  lines: string;
  step: string | null;
  updated_at: string;
}

const flat = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

const Lines = z.array(z.object({ thing: z.string(), now: z.string() }));

function parseLines(json: string): PageLine[] {
  try {
    const parsed = Lines.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const toPage = (row: Row | undefined): MindPage =>
  row ? { lines: parseLines(row.lines), step: row.step || null, updatedAt: row.updated_at } : { lines: [], step: null, updatedAt: null };

export function getPage(db: DB): MindPage {
  return toPage(db.prepare("SELECT * FROM page WHERE id = 1").get() as Row | undefined);
}

/** The bird rewrites the page. Blank lines are dropped and it never grows past a few lines. */
export function savePage(db: DB, page: { lines: readonly PageLine[]; step: string | null }): MindPage {
  const lines = page.lines
    .map((l) => ({ thing: flat(l.thing, PAGE_THING_MAX), now: flat(l.now, PAGE_LINE_MAX) }))
    .filter((l) => l.now)
    .slice(0, PAGE_LINES_MAX);
  const step = page.step ? flat(page.step, PAGE_STEP_MAX) || null : null;
  const row = db
    .prepare(
      `INSERT INTO page (id, lines, step) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET lines = excluded.lines, step = excluded.step,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       RETURNING *`,
    )
    .get(JSON.stringify(lines), step) as Row;
  return toPage(row);
}

/**
 * You ticked the step off, or said it isn't for you. It leaves the page, and the bird remembers
 * which it was so it doesn't hand you the same one again.
 */
export function answerStep(db: DB, status: "done" | "dismissed"): MindPage {
  return db.transaction(() => {
    const page = getPage(db);
    if (!page.step) return page;
    addNote(db, status === "done" ? "did" : "nope", page.step);
    db.prepare("UPDATE page SET step = NULL WHERE id = 1").run();
    return getPage(db);
  })();
}

// ---------- which bubbles still float ----------

/** Your thoughts the bird hasn't taken into the page yet: these still float in the world. */
export function floating(thoughts: readonly Thought[]): Thought[] {
  return thoughts.filter((t) => t.source !== "bird" && !t.settledAt);
}

export function unsettled(db: DB): Thought[] {
  const rows = db.prepare("SELECT * FROM thoughts WHERE source != 'bird' AND settled_at IS NULL ORDER BY id ASC").all() as ThoughtRow[];
  return rows.map(toThought);
}

/** The bird has taken these into the page: their bubbles may float away. */
export function settle(db: DB, ids: readonly number[]): void {
  const mark = db.prepare("UPDATE thoughts SET settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND settled_at IS NULL");
  db.transaction(() => {
    for (const id of ids) mark.run(id);
  })();
}

/**
 * What the world shows: only the bubbles still floating, loose. No shelves, no links, and none of
 * the bird's own thoughts. Everything else is kept, but stays out of sight.
 */
export function worldView(lib: Library): Library {
  return {
    thoughts: floating(lib.thoughts).map((t) => ({ ...t, clusterId: null, placedBy: null })),
    clusters: [],
    links: [],
    review: 0,
    steps: [],
  };
}
