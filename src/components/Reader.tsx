"use client";

import { useEffect, useState } from "react";
import type { Thought } from "@/lib/thoughts";

interface Props {
  thought: Thought;
  /** The shelf it sits on, if any. */
  shelf: string | null;
  onClose: () => void;
  onLetGo: (id: number) => void;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}

/** A bubble, opened: the page the bird typed. */
export function Reader({ thought, shelf, onClose, onLetGo }: Props) {
  const bird = thought.source === "bird";
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="reader-veil" onClick={onClose}>
      <article className="page" role="dialog" aria-modal="true" aria-label="A thought" onClick={(e) => e.stopPropagation()}>
        <header className="page-head">
          <span>{when(thought.createdAt)}</span>
          <span className="stamp">{bird ? "the bird wrote this" : thought.source === "spoken" ? "said out loud" : "written"}</span>
        </header>
        {shelf && !bird && <p className="page-shelf">on the shelf: {shelf}</p>}
        {thought.prompt && (
          <p className="page-prompt" dir="auto">
            the bird asked: {thought.prompt}
          </p>
        )}
        <p className="page-body" dir="auto">
          {thought.body}
        </p>
        <footer className="page-foot">
          {confirming ? (
            <>
              <span className="muted">pop it for good?</span>
              <button className="pill ghost" onClick={() => setConfirming(false)}>
                keep it
              </button>
              <button className="pill danger" onClick={() => onLetGo(thought.id)}>
                pop
              </button>
            </>
          ) : (
            <>
              <button className="pill ghost" onClick={() => setConfirming(true)}>
                let it go
              </button>
              <button className="pill" onClick={onClose} autoFocus>
                back to the sky
              </button>
            </>
          )}
        </footer>
      </article>
    </div>
  );
}
