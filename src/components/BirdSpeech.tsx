"use client";

import { useEffect, useRef, useState } from "react";

export interface Line {
  key: number;
  text: string;
  seconds: number;
}

interface Props {
  line: Line | null;
  anchor: () => { x: number; y: number; visible: boolean } | null;
  /** Tapping one of the bird's questions starts an answer. */
  onAnswer: (question: string) => void;
  /** You don't want this question. */
  onSkip: (question: string) => void;
}

const SCREEN_MARGIN = 12;
const isQuestion =(text: string) => text.trim().endsWith("?");

/** The bird's little thought bubbles: they follow its head, then drift up and vanish. */
export function BirdSpeech({ line, anchor, onAnswer, onSkip }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Line | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!line) return;
    setShown(line);
    setLeaving(false);
    const out = setTimeout(() => setLeaving(true), line.seconds * 1000);
    const gone = setTimeout(() => setShown((s) => (s?.key === line.key ? null : s)), line.seconds * 1000 + 600);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [line]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = anchor();
      const el = box.current;
      if (!a || !el) return;
      // Keep the whole bubble on screen (it sits 30% left of the anchor), even when the bird wanders to an edge.
      const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
      const lo = SCREEN_MARGIN + w * 0.3;
      const hi = window.innerWidth - SCREEN_MARGIN - w * 0.7;
      const x = lo < hi ? Math.min(hi, Math.max(lo, a.x)) : a.x;
      const y = Math.max(SCREEN_MARGIN + 60, a.y);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.visibility = a.visible ? "visible" : "hidden";
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [anchor]);

  return (
    <div ref={box} className="speech-anchor" aria-live="polite">
      {shown && (
        <div key={shown.key} className="speech" data-leaving={leaving || undefined} dir="auto">
          {isQuestion(shown.text) ? (
            <>
              <button type="button" className="speech-ask" onClick={() => onAnswer(shown.text.trim())}>
                <span className="speech-text">{shown.text}</span>
                <span className="speech-hint">tap to answer</span>
              </button>
              <button
                type="button"
                className="speech-skip"
                onClick={() => {
                  setShown(null);
                  onSkip(shown.text.trim());
                }}
              >
                not this one
              </button>
            </>
          ) : (
            <span className="speech-text">{shown.text}</span>
          )}
          <i className="dot d1" />
          <i className="dot d2" />
        </div>
      )}
    </div>
  );
}
