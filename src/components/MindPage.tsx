"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { MindPage as Page } from "@/lib/page";

interface Props {
  page: Page;
  /** How many thoughts the bird is still taking in (their bubbles still float). */
  reading: number;
  /** You haven't said anything yet. */
  empty: boolean;
  /** You did the small step. */
  onDone: () => void;
  /** The small step isn't for you. */
  onDismiss: () => void;
}

const FOLD_KEY = "mybrary:page-folded";
/** How long a ticked step stays on the page before it goes. */
const TICK_MS = 650;
/** Below this width the page starts folded, so the world stays in view. */
const NARROW_PX = 640;

function loadFolded(): boolean {
  try {
    const saved = window.localStorage.getItem(FOLD_KEY);
    return saved === null ? window.innerWidth < NARROW_PX : saved === "1";
  } catch {
    return false;
  }
}

function saveFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEY, folded ? "1" : "0");
  } catch {
    // Private windows may refuse: the page just opens the default way next time.
  }
}

/**
 * The one page the bird keeps: what's on your mind right now, and at most one small step.
 * It's all there is to read. The thoughts themselves float away once they're in here.
 */
export function MindPage({ page, reading, empty, onDone, onDismiss }: Props) {
  const [folded, setFolded] = useState(false);
  const [ticked, setTicked] = useState(false);

  useEffect(() => setFolded(loadFolded()), []);
  // A new step is a new, unticked step.
  useEffect(() => setTicked(false), [page.step]);

  const toggle = () => {
    saveFolded(!folded);
    setFolded(!folded);
  };

  const tick = () => {
    setTicked(true);
    setTimeout(onDone, TICK_MS);
  };

  const written = page.lines.length > 0;
  return (
    <aside className="mindpage" data-folded={folded || undefined} aria-label="What's on your mind">
      <button type="button" className="mindpage-head" aria-expanded={!folded} onClick={toggle}>
        <span className="mindpage-title">on your mind</span>
        {folded && written && <span className="mindpage-n">{page.lines.length}</span>}
        <span className="mindpage-fold" aria-hidden>
          {folded ? "+" : "–"}
        </span>
      </button>

      {!folded && (
        <div className="mindpage-body">
          {written ? (
            // Keyed by the rewrite, so a new page types itself in again.
            <ol key={page.updatedAt} className="mindpage-lines">
              {page.lines.map((l, i) => (
                <li key={`${l.thing}-${i}`} style={{ "--i": i } as CSSProperties} dir="auto">
                  {l.thing && <b>{l.thing}</b>}
                  <span>{l.now}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mindpage-empty">
              {empty
                ? "nothing yet. say what's on your mind, and the bird keeps this page for you."
                : reading > 0
                  ? "the bird is reading. your page will be here in a minute."
                  : "the page is empty."}
            </p>
          )}

          {page.step && (
            <div className="mindpage-step" data-done={ticked || undefined}>
              <span className="mindpage-label">one small step</span>
              <div className="mindpage-step-row">
                <button type="button" className="step-tick" aria-label={`Done: ${page.step}`} disabled={ticked} onClick={tick} />
                <span className="mindpage-step-text" dir="auto">
                  {page.step}
                </span>
                <button type="button" className="step-x" aria-label={`Not for me: ${page.step}`} title="not for me" disabled={ticked} onClick={onDismiss}>
                  ×
                </button>
              </div>
            </div>
          )}

          {reading > 0 && written && (
            <p className="mindpage-reading" role="status">
              the bird is taking in {reading === 1 ? "a new thought" : `${reading} new thoughts`}
              <i className="mindpage-dots" aria-hidden />
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
