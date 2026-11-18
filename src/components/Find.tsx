"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MIN_LETTERS, findBubbles, snippet } from "@/lib/find";
import type { Thought } from "@/lib/thoughts";

interface Props {
  thoughts: Thought[];
  /** Bubbles to light up (an empty list turns the lights off). */
  onMark: (ids: number[]) => void;
  /** Fly the camera to a bubble, or back to the middle with null. */
  onFly: (id: number | null) => void;
  /** Open a thought to read it. Most of them no longer float, so this is how you get one back. */
  onOpen: (id: number) => void;
}

const SHOWN = 6;

/** Type a word: every thought that has it is listed. Pick one to read it; if it still floats, it glows too. */
export function Find({ thoughts, onMark, onFly, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** Whether the camera has flown to a match since the list last changed. */
  const flown = useRef(false);
  const found = useMemo(() => (open ? findBubbles(thoughts, query) : []), [open, thoughts, query]);
  const ids = useMemo(() => found.map((t) => t.id), [found]);

  // Lights follow what you typed, without re-firing while nothing changed.
  const key = ids.join(",");
  useEffect(() => {
    if (!open) return;
    onMark(ids);
    setAt(0);
    flown.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    onMark([]);
    onFly(null);
  };

  const go = (i: number) => {
    const t = found[i];
    if (!t) return;
    setAt(i);
    flown.current = true;
    onFly(t.id);
    onOpen(t.id);
  };

  if (!open) {
    return (
      <button type="button" className="round find-open" aria-label="Find something you said" onClick={() => setOpen(true)}>
        <SearchIcon />
      </button>
    );
  }

  const typed = query.trim().length >= MIN_LETTERS;
  return (
    <div className="find" role="search">
      <div className="find-bar">
        <SearchIcon />
        <input
          ref={input}
          value={query}
          dir="auto"
          placeholder="find a word in what you said"
          aria-label="Find a word in what you said"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            // Enter opens the match that's picked.
            else if (e.key === "Enter" && found.length) go(at);
          }}
        />
        {typed && <span className="find-count">{found.length === 1 ? "1 thought" : `${found.length} thoughts`}</span>}
        <button type="button" className="reply-x" aria-label="Stop looking" onClick={close}>
          ×
        </button>
      </div>
      {found.length > 0 && (
        <ul className="find-list">
          {found.slice(0, SHOWN).map((t, i) => (
            <li key={t.id}>
              <button type="button" dir="auto" data-on={i === at || undefined} onClick={() => go(i)}>
                {snippet(t.body, query.trim())}
              </button>
            </li>
          ))}
          {found.length > SHOWN && <li className="find-more">and {found.length - SHOWN} more. add a word to narrow it down.</li>}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M16 16l4.2 4.2" />
    </svg>
  );
}
