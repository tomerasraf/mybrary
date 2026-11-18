"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageState } from "@/app/api/page/route";
import type { ApiResult } from "@/lib/api";
import { LOOKING, NO_ANSWER, POP, STEP_DONE, STEP_NOPE, TOLD, WAVED, daysSince, greeting, pick } from "@/lib/bird/lines";
import type { Library } from "@/lib/library";
import { floating, type MindPage as Page } from "@/lib/page";
import type { Thought, ThoughtSource } from "@/lib/thoughts";
import { ding, loadMuted, setMuted, unlockAudio } from "@/world/sound";
import { BirdSpeech, type Line } from "./BirdSpeech";
import { Composer } from "./Composer";
import { Find } from "./Find";
import { Guide } from "./Guide";
import { MindPage } from "./MindPage";
import { Reader } from "./Reader";
import { useWorld } from "./useWorld";

// A local model can take a while, especially the first time it loads, and the bird thinks before it asks.
const THINK_TIMEOUT_MS = 70_000;
/** How long you can still answer the bird's question after it asks. */
const QUESTION_OPEN_MS = 120_000;
/** How long the bubbles behind the bird's answer keep glowing. */
const ANSWER_GLOW_MS = 25_000;
/** While bubbles float, how often to look whether the bird has taken them into the page. */
const PAGE_POLL_MS = 7000;
/** Every so often while waiting, nudge the bird in case it stopped reading (a restart, a hiccup). */
const NUDGE_EVERY = 8;
/** The bird never takes a thought into the page sooner than this after you send it. */
const JUST_SENT_MS = 15_000;

async function api<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<ApiResult<T>> {
  const ctl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, headers: { "Content-Type": "application/json", ...init?.headers } });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { success: false, data: null, error: "Couldn't reach the app. Is it still running?" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function Mind({ initial, initialPage }: { initial: Library; initialPage: Page }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Everything you ever said. Only the ones the bird hasn't taken into the page still float. */
  const [thoughts, setThoughts] = useState(() => initial.thoughts.filter((t) => t.source !== "bird"));
  const [page, setPage] = useState(initialPage);
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
    const mine = initial.thoughts.filter((t) => t.source !== "bird");
    return greeting(mine.length, daysSince(mine.at(-1)?.createdAt ?? null));
  }, [initial]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  }, []);

  /** `asks`: a line ending in "?" is a question you can answer. Not so for the bird's answers to you. */
  const say = useCallback((text: string, seconds: number, asks = true) => {
    lineKey.current += 1;
    setLine({ key: lineKey.current, text, seconds });
    if (asks && text.trim().endsWith("?")) setQuestion(text.trim());
  }, []);

  // ---------- the bird's brain ----------

  const think = useCallback(async (id: number): Promise<string | null> => {
    const res = await api<{ question: string | null }>("/api/bird/reflect", { method: "POST", body: JSON.stringify({ id }) }, THINK_TIMEOUT_MS);
    return res.success ? res.data.question : null;
  }, []);

  // ---------- you, talking back (no bubble is made) ----------

  const skipQuestion = useCallback(
    async (q: string) => {
      setQuestion((cur) => (cur === q ? null : cur));
      setReplyTo((cur) => (cur === q ? null : cur));
      say(pick(WAVED), 3);
      const res = await api<unknown>("/api/bird/feedback", { method: "POST", body: JSON.stringify({ kind: "skip", question: q }) });
      if (!res.success) flash(res.error);
    },
    [flash, say],
  );

  // Lights on a group of bubbles for a while, and (if asked) the camera on the newest of them.
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((ids: number[], fly: boolean) => {
    if (glowTimer.current) clearTimeout(glowTimer.current);
    world.current?.mark(ids);
    if (fly && ids.length) world.current?.flyTo(ids[ids.length - 1]);
    glowTimer.current = ids.length === 0 ? null : setTimeout(() => world.current?.mark([]), ANSWER_GLOW_MS);
    // `world` is a stable ref (declared below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askBird = useCallback(
    async (question: string) => {
      setBusy(true);
      say(pick(LOOKING), 6, false);
      const res = await api<{ answer: string | null; ids: number[] }>(
        "/api/bird/ask",
        { method: "POST", body: JSON.stringify({ question }) },
        THINK_TIMEOUT_MS,
      );
      setBusy(false);
      if (!res.success) {
        flash(res.error);
        return false;
      }
      if (res.data.answer) {
        say(res.data.answer, 14, false);
        // The camera stays put: flying off would take the bird, and its answer, out of view.
        show(res.data.ids, false);
      } else say(pick(NO_ANSWER), 5, false);
      return true;
    },
    [flash, say, show],
  );

  const tellBird = useCallback(
    async (text: string, about: string | null) => {
      // A question is something to answer from the bubbles; anything else is something to remember.
      if (text.trim().endsWith("?")) return askBird(text.trim());
      const res = await api<unknown>("/api/bird/feedback", { method: "POST", body: JSON.stringify({ kind: "tell", text, about }) });
      if (!res.success) {
        flash(res.error);
        return false;
      }
      if (about) setQuestion((cur) => (cur === about ? null : cur));
      say(pick(TOLD), 3.5);
      return true;
    },
    [askBird, flash, say],
  );

  const onOpen = useCallback((id: number) => setOpenId(id), []);
  const { world, failed } = useWorld(canvas, initial, { greeting: hello, say, think, onOpen });

  // ---------- the page ----------

  const thoughtsRef = useRef(thoughts);
  thoughtsRef.current = thoughts;
  const pageRef = useRef(page);
  /** When each thought of this visit was sent, by id. */
  const sentAt = useRef(new Map<number, number>());
  pageRef.current = page;

  /** The bird's page as saved: bubbles it has taken in float away, and a rewritten page rings in. */
  const takeIn = useCallback(
    (state: PageState) => {
      const still = new Set(state.floating);
      // A thought you sent a moment ago can be missing from an answer that was already on its way: the
      // bird can't have taken it in that fast, so it stays.
      const justSent = (id: number) => Date.now() - (sentAt.current.get(id) ?? 0) < JUST_SENT_MS;
      const gone = floating(thoughtsRef.current)
        .filter((t) => !still.has(t.id) && !justSent(t.id))
        .map((t) => t.id);
      if (gone.length > 0) {
        const at = new Date().toISOString();
        setThoughts((list) => list.map((t) => (gone.includes(t.id) ? { ...t, settledAt: at } : t)));
        world.current?.settle(gone);
      }
      if (state.page.updatedAt !== pageRef.current.updatedAt) {
        setPage(state.page);
        ding();
      }
    },
    [world],
  );

  const waiting = floating(thoughts).length;
  useEffect(() => {
    if (waiting === 0) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks % NUDGE_EVERY === 0) void api("/api/bird/wake", { method: "POST" });
      void api<PageState>("/api/page").then((res) => res.success && takeIn(res.data));
    }, PAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting > 0, takeIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const answerStep = useCallback(
    async (status: "done" | "dismissed") => {
      const res = await api<Page>("/api/page/step", { method: "POST", body: JSON.stringify({ status }) });
      if (!res.success) {
        flash(res.error);
        return;
      }
      setPage(res.data);
      // The bird wants to hear how it went: its question can be answered into a new thought.
      say(pick(status === "done" ? STEP_DONE : STEP_NOPE), status === "done" ? 8 : 3);
    },
    [flash, say],
  );

  // ---------- writing ----------

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
      sentAt.current.set(res.data.id, Date.now());
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
      <BirdSpeech line={line} anchor={anchor} onAnswer={(q) => setReplyTo(q)} onSkip={(q) => void skipQuestion(q)} />

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
      <Guide />
      {thoughts.length > 0 && (
        <Find
          thoughts={thoughts}
          onMark={(ids) => world.current?.mark(ids)}
          onFly={(id) => world.current?.flyTo(id)}
          onOpen={(id) => setOpenId(id)}
        />
      )}
      <MindPage page={page} reading={waiting} empty={thoughts.length === 0} onDone={() => void answerStep("done")} onDismiss={() => void answerStep("dismissed")} />

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
        onSkip={(q) => void skipQuestion(q)}
        onTell={tellBird}
        onComposing={onComposing}
        onKeystroke={onKeystroke}
        onRelease={onRelease}
      />
      {open && <Reader thought={open} shelf={null} onClose={close} onLetGo={onLetGo} />}
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
