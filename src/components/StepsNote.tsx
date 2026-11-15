"use client";

import { useState } from "react";
import type { Step } from "@/lib/steps";

interface Props {
  steps: Step[];
  /** The shelf each bubble sits on now, by bubble id. */
  shelfOf: Map<number, string>;
  onDone: (id: number) => void;
  onDismiss: (id: number) => void;
  /** Opens the bubble a step came from. */
  onSource: (thoughtId: number) => void;
}

/** How long a ticked step stays on the note before it goes. */
const TICK_MS = 650;

/** The bird's little to-do slip: a few small steps it found in your bubbles. */
export function StepsNote({ steps, shelfOf, onDone, onDismiss, onSource }: Props) {
  const [ticked, setTicked] = useState<number[]>([]);
  if (steps.length === 0) return null;

  const tick = (id: number) => {
    setTicked((list) => [...list, id]);
    setTimeout(() => onDone(id), TICK_MS);
  };

  return (
    <aside className="steps" aria-label="Small steps from the bird">
      <h2 className="steps-title">small steps</h2>
      <ul>
        {steps.map((s) => {
          const shelf = s.thoughtId !== null ? shelfOf.get(s.thoughtId) : undefined;
          const done = ticked.includes(s.id);
          return (
            <li key={s.id} className="step" data-done={done || undefined}>
              <button type="button" className="step-tick" aria-label={`Done: ${s.body}`} disabled={done} onClick={() => tick(s.id)} />
              <div className="step-text">
                <span className="step-body" dir="auto">
                  {s.body}
                </span>
                {s.thoughtId !== null && (
                  <button type="button" className="step-from" onClick={() => onSource(s.thoughtId as number)}>
                    {shelf ? `from “${shelf}”` : "from a bubble"}
                  </button>
                )}
              </div>
              <button type="button" className="step-x" aria-label={`Not for me: ${s.body}`} onClick={() => onDismiss(s.id)}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
