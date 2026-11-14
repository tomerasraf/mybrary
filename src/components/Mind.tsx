"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResult } from "@/lib/api";
import { POP, daysSince, greeting, pick } from "@/lib/bird/lines";
import type { Thought, ThoughtSource } from "@/lib/thoughts";
import type { Ponder, ThinkRequest } from "@/world/brain";
import { loadMuted, setMuted, unlockAudio } from "@/world/sound";
import { BirdSpeech, type Line } from "./BirdSpeech";
import { Composer } from "./Composer";
import { Reader } from "./Reader";
import { useWorld } from "./useWorld";

// A local model can take a while, especially the first time it loads.
const THINK_TIMEOUT_MS = 45_000;
/** How long you can still answer the bird's question after it asks. */
const QUESTION_OPEN_MS = 90_000;

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { success: false, data: null, error: "Couldn't reach the app. Is it still running?" };
  }
}

export function Mind({ initialThoughts }: { initialThoughts: Thought[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [thoughts, setThoughts] = useState(initialThoughts);
  const [openId, setOpenId] = useState<number | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const lineKey = useRef(0);
  const [question, setQuestion] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  // Wake the local model up so the bird's first thought is quick.
  useEffect(() => {
    void api("/api/bird/wake", { method: "POST" });
  }, []);

  // A question stays answerable for a while, unless you're already answering it.
  useEffect(() => {
    if (!question || replyTo === question) return;
    const t = setTimeout(() => setQuestion(null), QUESTION_OPEN_MS);
    return () => clearTimeout(t);
  }, [question, replyTo]);

  useEffect(() => setMutedState(loadMuted()), []);

  const hello = useMemo(() => {
    const last = initialThoughts.at(-1)?.createdAt ?? null;
    return greeting(initialThoughts.length, daysSince(last));
  }, [initialThoughts]);

  const say = useCallback((text: string, seconds: number) => {
    lineKey.current += 1;
    setLine({ key: lineKey.current, text, seconds });
    if (text.trim().endsWith("?")) setQuestion(text.trim());
  }, []);

  const think = useCallback(async (req: ThinkRequest): Promise<Ponder | null> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), THINK_TIMEOUT_MS);
    const res = await api<Ponder>("/api/bird/ponder", {
      method: "POST",
      body: JSON.stringify(req),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    return res.success ? res.data : null;
  }, []);

  const onOpen = useCallback((id: number) => setOpenId(id), []);
  const { world, failed } = useWorld(canvas, initialThoughts, { greeting: hello, say, think, onOpen });

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  }, []);

  const onComposing = useCallback((v: boolean) => world.current?.setComposing(v), [world]);
  const onKeystroke = useCallback((n: number) => world.current?.keystroke(n), [world]);

  const onRelease = useCallback(
    async (body: string, source: ThoughtSource) => {
      setBusy(true);
      const res = await api<Thought>("/api/thoughts", {
        method: "POST",
        body: JSON.stringify({ body, source, prompt: replyTo }),
      });
      setBusy(false);
      if (!res.success) {
        flash(res.error);
        return false;
      }
      setThoughts((list) => [...list, res.data]);
      world.current?.deliver(res.data);
      if (replyTo) {
        setReplyTo(null);
        setQuestion(null);
      }
      return true;
    },
    [flash, replyTo, world],
  );

  const onLetGo = useCallback(
    async (id: number) => {
      const res = await api<{ id: number }>(`/api/thoughts/${id}`, { method: "DELETE" });
      if (!res.success) {
        flash(res.error);
        return;
      }
      setOpenId(null);
      world.current?.focus(null);
      setThoughts((list) => list.filter((t) => t.id !== id));
      await world.current?.pop(id);
      say(pick(POP), 2.5);
    },
    [flash, say, world],
  );

  const close = useCallback(() => {
    setOpenId(null);
    world.current?.focus(null);
  }, [world]);

  const open = openId === null ? null : (thoughts.find((t) => t.id === openId) ?? null);
  useEffect(() => {
    if (open) world.current?.focus(open.id);
  }, [open, world]);

  const anchor = useCallback(() => world.current?.birdAnchor() ?? null, [world]);

  return (
    <main className="mind" onPointerDown={unlockAudio}>
      <canvas ref={canvas} className="world" />
      <BirdSpeech line={line} anchor={anchor} onAnswer={(q) => setReplyTo(q)} />

      <button
        className="round sound"
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
        aria-pressed={!muted}
        onClick={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      >
        <SpeakerIcon muted={muted} />
      </button>
      {thoughts.length > 0 && <p className="count">{thoughts.length === 1 ? "1 bubble" : `${thoughts.length} bubbles`}</p>}

      {failed && <p className="fallback">{failed}</p>}
      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}

      <Composer
        busy={busy}
        question={question}
        replyTo={replyTo}
        onReply={setReplyTo}
        onComposing={onComposing}
        onKeystroke={onKeystroke}
        onRelease={onRelease}
      />
      {open && <Reader thought={open} onClose={close} onLetGo={onLetGo} />}
    </main>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}
