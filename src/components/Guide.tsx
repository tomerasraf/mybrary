"use client";

import { useCallback, useEffect, useState } from "react";
import { DO, DONT, GUIDE, TOUR } from "@/lib/guide";

const TOURED_KEY = "mybrary:toured";
/** Space between the ring and the thing it points at. */
const RING_PAD = 8;

/** Whether you've been shown around already. A browser that won't say counts as yes, so the tour never nags. */
function toured(): boolean {
  try {
    return window.localStorage.getItem(TOURED_KEY) !== null;
  } catch {
    return true;
  }
}

function markToured(): void {
  try {
    window.localStorage.setItem(TOURED_KEY, "1");
  } catch {
    // Nothing to do: the guide is still behind the "?" button.
  }
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a thing sits on screen right now, kept up to date while the window changes. */
function useBox(selector: string | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!selector) {
      setBox(null);
      return;
    }
    const measure = () => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      setBox(r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
    };
    measure();
    // The composer grows and things settle in: look again a few times.
    const again = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(again);
      window.removeEventListener("resize", measure);
    };
  }, [selector]);
  return box;
}

/** The first-visit walk through the app, one small card at a time. */
function Tour({ onDone }: { onDone: () => void }) {
  const [at, setAt] = useState(0);
  const step = TOUR[at];
  const box = useBox(step.target);
  const last = at === TOUR.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      // (Enter already presses the focused "next" button.)
      else if (e.key === "ArrowRight") {
        if (at === TOUR.length - 1) onDone();
        else setAt(at + 1);
      } else if (e.key === "ArrowLeft") setAt(Math.max(0, at - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, onDone]);

  // The card keeps clear of what it points at: up top when that's at the bottom of the screen.
  const low = box !== null && box.top > window.innerHeight * 0.55;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="A quick look around">
      {box && (
        <i
          className="tour-ring"
          style={{
            left: box.left - RING_PAD,
            top: box.top - RING_PAD,
            width: box.width + RING_PAD * 2,
            height: box.height + RING_PAD * 2,
          }}
        />
      )}
      <section key={at} className="tour-card" data-high={low || undefined}>
        <h2 className="card-title">{step.title}</h2>
        <p className="tour-text">{step.text}</p>
        <div className="tour-dots" aria-hidden>
          {TOUR.map((s, i) => (
            <i key={s.title} data-on={i === at || undefined} />
          ))}
        </div>
        <footer className="card-foot">
          {at > 0 ? (
            <button type="button" className="pill ghost" onClick={() => setAt(at - 1)}>
              back
            </button>
          ) : (
            <button type="button" className="pill ghost" onClick={onDone}>
              skip
            </button>
          )}
          <button type="button" className="pill" autoFocus onClick={() => (last ? onDone() : setAt(at + 1))}>
            {last ? "let's go" : "next"}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Everything the app can do, on one page you can come back to. */
function GuidePanel({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="card-veil guide-veil" onClick={onClose}>
      <section className="card guide" role="dialog" aria-modal="true" aria-label="How to use Mybrary" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">how it works</h2>
        <div className="guide-body">
          {GUIDE.map((s) => (
            <section key={s.title}>
              <h3 className="know-title">{s.title}</h3>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
          <section>
            <h3 className="know-title">👍 do</h3>
            <ul>
              {DO.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="know-title">👎 don&apos;t</h3>
            <ul>
              {DONT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
        <footer className="card-foot">
          <button type="button" className="pill ghost" onClick={onTour}>
            show me around again
          </button>
          <button type="button" className="pill" autoFocus onClick={onClose}>
            got it
          </button>
        </footer>
      </section>
    </div>
  );
}

/** The "?" button, the guide behind it, and the walk-through on a first visit. */
export function Guide() {
  const [touring, setTouring] = useState(false);
  const [open, setOpen] = useState(false);

  // A first visit starts with the walk-through, once the world has had a moment to appear.
  useEffect(() => {
    if (toured()) return;
    const t = setTimeout(() => setTouring(true), 1800);
    return () => clearTimeout(t);
  }, []);

  const endTour = useCallback(() => {
    markToured();
    setTouring(false);
  }, []);

  return (
    <>
      <button type="button" className="round guide-open" aria-label="How to use Mybrary" onClick={() => setOpen(true)}>
        ?
      </button>
      {touring && <Tour onDone={endTour} />}
      {open && (
        <GuidePanel
          onClose={() => setOpen(false)}
          onTour={() => {
            setOpen(false);
            setTouring(true);
          }}
        />
      )}
    </>
  );
}
