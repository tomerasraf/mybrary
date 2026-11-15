"use client";

import { useEffect, useState } from "react";
import { SHELF_COLORS, SHELF_COLOR_KEYS, type ShelfColor } from "@/lib/colors";
import type { Cluster } from "@/lib/library";

interface Props {
  shelf: Cluster;
  /** How many bubbles sit on it. */
  count: number;
  onClose: () => void;
  onChange: (id: number, patch: { name?: string; color?: ShelfColor }) => void;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** A shelf, tapped: its name to change, and a few colours to paint it. */
export function ShelfCard({ shelf, count, onClose, onChange }: Props) {
  const [name, setName] = useState(shelf.name);
  useEscape(onClose);
  useEffect(() => setName(shelf.name), [shelf.name]);

  const nook = shelf.kind === "nook";
  const commit = () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean && clean !== shelf.name) onChange(shelf.id, { name: clean });
    else setName(shelf.name);
  };

  return (
    <div className="card-veil" onClick={onClose}>
      <section className="card" role="dialog" aria-modal="true" aria-label={nook ? "The bird's shelf" : "A shelf"} onClick={(e) => e.stopPropagation()}>
        {nook ? (
          <>
            <h2 className="card-title">the bird&apos;s thoughts</h2>
            <p className="card-note">
              the bird writes here about its library: what it sees in your bubbles, and what you might do about them. tap a bubble inside to
              read it.
            </p>
          </>
        ) : (
          <>
            <input
              className="card-name"
              value={name}
              maxLength={28}
              aria-label="Shelf name"
              dir="auto"
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  e.preventDefault();
                }
              }}
            />
            <p className="card-note">{count === 1 ? "1 bubble on this shelf" : `${count} bubbles on this shelf`}</p>
            <div className="swatches" role="radiogroup" aria-label="Colour">
              {SHELF_COLOR_KEYS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={shelf.color === c}
                  aria-label={c}
                  className="swatch"
                  style={{ background: SHELF_COLORS[c] }}
                  onClick={() => onChange(shelf.id, { color: c })}
                />
              ))}
            </div>
            <p className="card-hint">drag bubbles in or out to change what&apos;s on it</p>
          </>
        )}
        <footer className="card-foot">
          <button className="pill" onClick={onClose} autoFocus={nook}>
            done
          </button>
        </footer>
      </section>
    </div>
  );
}

interface LinkProps {
  word: string;
  onClose: () => void;
  onPop: () => void;
}

/** A link, tapped: what the bird saw, and a way to pop it if you disagree. */
export function LinkCard({ word, onClose, onPop }: LinkProps) {
  useEscape(onClose);
  return (
    <div className="card-veil" onClick={onClose}>
      <section className="card small" role="dialog" aria-modal="true" aria-label="A link" onClick={(e) => e.stopPropagation()}>
        <p className="card-note">the bird linked these two:</p>
        <h2 className="card-title" dir="auto">
          “{word}”
        </h2>
        <footer className="card-foot">
          <button className="pill ghost" onClick={onPop}>
            pop the link
          </button>
          <button className="pill" onClick={onClose} autoFocus>
            keep it
          </button>
        </footer>
      </section>
    </div>
  );
}
