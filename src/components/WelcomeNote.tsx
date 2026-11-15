"use client";

import { useEffect, useState } from "react";
import type { ApiResult } from "@/lib/api";
import type { Welcome } from "@/app/api/bird/welcome/route";

interface Props {
  /** How many small steps are still waiting. */
  openSteps: number;
  /** Opens a bubble. */
  onOpen: (id: number) => void;
  /** Lights up a group of bubbles and flies to the newest. */
  onShow: (ids: number[]) => void;
}

const SEEN_KEY = "mybrary:last-seen";
/** Away for less than this, and there's nothing to catch up on. */
const AWAY_MS = 6 * 60 * 60 * 1000;

/** When you were last here, or null on a first visit (or when the browser won't say). */
function lastSeen(): number | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Private windows may refuse: the note just won't show next time.
  }
}

function ago(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 2) return `${days} days`;
  if (days === 1) return "a day";
  return `${Math.max(1, Math.floor(ms / (60 * 60 * 1000)))} hours`;
}

/** Where you left off: the last thing you wrote, what's still waiting, and what keeps coming back. */
export function WelcomeNote({ openSteps, onOpen, onShow }: Props) {
  const [note, setNote] = useState<(Welcome & { away: number }) | null>(null);

  useEffect(() => {
    const seen = lastSeen();
    markSeen();
    // Keep the clock fresh while you're here, so only a real absence counts.
    const tick = setInterval(markSeen, 5 * 60 * 1000);
    const away = seen === null ? 0 : Date.now() - seen;
    if (away >= AWAY_MS) {
      fetch("/api/bird/welcome")
        .then((r) => r.json() as Promise<ApiResult<Welcome>>)
        .then((res) => {
          if (res.success && res.data.last) setNote({ ...res.data, away });
        })
        .catch(() => undefined);
    }
    return () => clearInterval(tick);
  }, []);

  if (!note?.last) return null;
  const last = note.last;
  return (
    <aside className="welcome" aria-label="Where you left off">
      <h2 className="steps-title">you were away {ago(note.away)}</h2>
      <ul>
        <li>
          <span className="welcome-label">you left off with</span>
          <button type="button" className="welcome-line" dir="auto" onClick={() => onOpen(last.id)}>
            {last.text}
          </button>
        </li>
        {openSteps > 0 && (
          <li>
            <span className="welcome-label">still waiting</span>
            <span className="welcome-plain">{openSteps === 1 ? "1 small step" : `${openSteps} small steps`}</span>
          </li>
        )}
        {note.patterns.map((p) => (
          <li key={p.name}>
            <span className="welcome-label">keeps coming back</span>
            <button type="button" className="welcome-line" dir="auto" onClick={() => onShow(p.ids)}>
              {p.name} <span className="welcome-n">in {p.count} bubbles this month</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="pill welcome-ok" onClick={() => setNote(null)}>
        ok
      </button>
    </aside>
  );
}
