"use client";

import { useEffect, useState } from "react";
import { SHELF_COLORS, SHELF_COLOR_KEYS, type ShelfColor } from "@/lib/colors";
import type { ApiResult } from "@/lib/api";
import type { Fact } from "@/lib/knowledge";
import type { Cluster } from "@/lib/library";

interface Props {
  shelf: Cluster;
  /** How many bubbles sit on it. */
  count: number;
  onClose: () => void;
  onChange: (id: number, patch: { name?: string; color?: ShelfColor; about?: string }) => void;
  /** You made the bird forget something. */
  onForgot?: () => void;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** What the bird knows for sure, with a way to make it forget anything it got wrong. */
function Knowledge({ onForgot }: { onForgot?: () => void }) {
  const [facts, setFacts] = useState<Fact[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/knowledge")
      .then((r) => r.json() as Promise<ApiResult<Fact[]>>)
      .then((res) => alive && setFacts(res.success ? res.data : []))
      .catch(() => alive && setFacts([]));
    return () => {
      alive = false;
    };
  }, []);

  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);

  const forget = (f: Fact) => {
    setFacts((list) => list?.filter((x) => !(x.id === f.id && x.kind === f.kind)) ?? null);
    void fetch(`/api/knowledge/${f.id}${f.kind === "waved" ? "?kind=waved" : ""}`, { method: "DELETE" }).then(() => onForgot?.());
  };

  const save = () => {
    const edit = editing;
    setEditing(null);
    const body = edit?.text.replace(/\s+/g, " ").trim();
    if (!edit || !body) return;
    setFacts((list) => list?.map((f) => (f.id === edit.id && f.kind !== "waved" ? { ...f, body } : f)) ?? null);
    void fetch(`/api/knowledge/${edit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  };

  if (!facts) return null;
  if (facts.length === 0) return <p className="card-hint">it hasn&apos;t learned any names yet. it reads every new bubble.</p>;
  return (
    <>
      <h3 className="know-title">what it knows</h3>
      <ul className="know">
        {facts.map((f) => (
          <li key={`${f.kind}-${f.id}`} data-rule={f.kind === "rule" || undefined} data-waved={f.kind === "waved" || undefined}>
            <span dir="auto">
              {f.kind === "rule" ? <b>you told it: </b> : f.kind === "waved" ? <b>it won&apos;t ask: </b> : <b>{f.name}: </b>}
              {f.kind !== "waved" && editing?.id === f.id ? (
                <input
                  className="know-edit"
                  autoFocus
                  dir="auto"
                  value={editing.text}
                  maxLength={f.kind === "rule" ? 300 : 160}
                  aria-label={`Correct: ${f.name ?? "what you told it"}`}
                  onChange={(e) => setEditing({ id: f.id, text: e.target.value })}
                  onBlur={save}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
              ) : f.kind === "waved" ? (
                f.body
              ) : (
                <button type="button" className="know-body" title="tap to correct it" onClick={() => setEditing({ id: f.id, text: f.body })}>
                  {f.body}
                </button>
              )}
            </span>
            <button type="button" className="know-x" aria-label={`Forget: ${f.name ?? f.body}`} onClick={() => forget(f)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="card-hint">all of it comes from your own words. tap a line to correct it, × to make it forget.</p>
    </>
  );
}

/** A shelf, tapped: its name to change, and a few colours to paint it. */
export function ShelfCard({ shelf, count, onClose, onChange, onForgot }: Props) {
  const [name, setName] = useState(shelf.name);
  const [about, setAbout] = useState(shelf.about ?? "");
  useEscape(onClose);
  useEffect(() => setName(shelf.name), [shelf.name]);
  useEffect(() => setAbout(shelf.about ?? ""), [shelf.about]);

  const nook = shelf.kind === "nook";
  const commit = () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean && clean !== shelf.name) onChange(shelf.id, { name: clean });
    else setName(shelf.name);
  };
  const commitAbout = () => {
    const clean = about.replace(/\s+/g, " ").trim();
    if (clean !== (shelf.about ?? "")) onChange(shelf.id, { about: clean });
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
            <Knowledge onForgot={onForgot} />
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
            <label className="about">
              <span className="about-label">what belongs here</span>
              <textarea
                rows={3}
                dir="auto"
                value={about}
                maxLength={160}
                placeholder="the bird will write this once it has read the bubbles. or write it yourself."
                onChange={(e) => setAbout(e.target.value)}
                onBlur={commitAbout}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
              <span className="about-by">
                {shelf.about
                  ? shelf.aboutBy === "you"
                    ? "your words. the bird sorts by them."
                    : "the bird wrote this. change it and it sorts by your words."
                  : "the bird sorts new bubbles by this line."}
              </span>
            </label>
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
  /** The words in each of the two bubbles that made the bird link them. */
  quotes?: [string, string] | null;
  onClose: () => void;
  onPop: () => void;
}

/** A link, tapped: what the bird saw, and a way to pop it if you disagree. */
export function LinkCard({ word, quotes, onClose, onPop }: LinkProps) {
  useEscape(onClose);
  return (
    <div className="card-veil" onClick={onClose}>
      <section className="card small" role="dialog" aria-modal="true" aria-label="A link" onClick={(e) => e.stopPropagation()}>
        <p className="card-note">the bird linked these two:</p>
        <h2 className="card-title" dir="auto">
          “{word}”
        </h2>
        {quotes && (
          <div className="link-why">
            <p className="card-hint">because one says</p>
            <blockquote dir="auto">“{quotes[0]}”</blockquote>
            <p className="card-hint">and the other says</p>
            <blockquote dir="auto">“{quotes[1]}”</blockquote>
          </div>
        )}
        <footer className="card-foot">
          <button className="pill ghost" onClick={onPop} title="the bird won't link these two again">
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
