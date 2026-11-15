"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResult } from "@/lib/api";
import { POP, STEP_DONE, daysSince, greeting, pick } from "@/lib/bird/lines";
import type { ShelfColor } from "@/lib/colors";
import type { Cluster, Library, Link, TidyResult } from "@/lib/library";
import type { Step } from "@/lib/steps";
import type { PlacedBy, Thought, ThoughtSource } from "@/lib/thoughts";
import type { Ponder, ThinkRequest } from "@/world/brain";
import { loadMuted, setMuted, unlockAudio } from "@/world/sound";
import { BirdSpeech, type Line } from "./BirdSpeech";
import { Composer } from "./Composer";
import { Reader } from "./Reader";
import { LinkCard, ShelfCard } from "./ShelfCard";
import { StepsNote } from "./StepsNote";
import { useWorld } from "./useWorld";

// A local model can take a while, especially the first time it loads.
const THINK_TIMEOUT_MS = 45_000;
/** Sorting and writing ask more of the brain. */
const WORK_TIMEOUT_MS = 75_000;
/** A slow brain request may still finish on the server after we stop waiting: look again after this. */
const LATE_RESYNC_MS = 60_000;
/** How long you can still answer the bird's question after it asks. */
const QUESTION_OPEN_MS = 90_000;

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

/** Shelves with nobody on them are gone (the server removes them too). */
function withoutEmptyShelves(clusters: Cluster[], thoughts: Thought[]): Cluster[] {
  const used = new Set(thoughts.map((t) => t.clusterId));
  return clusters.filter((c) => c.kind === "nook" || used.has(c.id));
}

export function Mind({ initial }: { initial: Library }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [thoughts, setThoughts] = useState(initial.thoughts);
  const [clusters, setClusters] = useState(initial.clusters);
  const [links, setLinks] = useState(initial.links);
  const [steps, setSteps] = useState(initial.steps);
  const [openId, setOpenId] = useState<number | null>(null);
  const [openShelf, setOpenShelf] = useState<number | null>(null);
  const [openLink, setOpenLink] = useState<number | null>(null);
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

  // Shelves nobody sits on any more are gone.
  useEffect(() => setClusters((cs) => withoutEmptyShelves(cs, thoughts)), [thoughts]);

  const hello = useMemo(() => {
    const mine = initial.thoughts.filter((t) => t.source !== "bird");
    return greeting(mine.length, daysSince(mine.at(-1)?.createdAt ?? null));
  }, [initial]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  }, []);

  const say = useCallback((text: string, seconds: number) => {
    lineKey.current += 1;
    setLine({ key: lineKey.current, text, seconds });
    if (text.trim().endsWith("?")) setQuestion(text.trim());
  }, []);

  // ---------- staying in line with what's saved ----------

  // Set once the world exists (below); a ref so the brain's hooks can call it at any time.
  const resyncRef = useRef<() => void>(() => {});
  const resync = useCallback(() => resyncRef.current(), []);
  const resyncLater = useCallback(() => {
    setTimeout(() => resyncRef.current(), LATE_RESYNC_MS);
  }, []);

  // ---------- the bird's brain ----------

  const think = useCallback(async (req: ThinkRequest): Promise<Ponder | null> => {
    const res = await api<Ponder>("/api/bird/ponder", { method: "POST", body: JSON.stringify(req) }, THINK_TIMEOUT_MS);
    return res.success ? res.data : null;
  }, []);

  const tidy = useCallback(async (): Promise<TidyResult | null> => {
    const res = await api<TidyResult>("/api/bird/tidy", { method: "POST" }, WORK_TIMEOUT_MS);
    if (!res.success) {
      resyncLater();
      return null;
    }
    const shelves = res.data.steps.flatMap((s) => (s.kind === "shelf" ? [s.cluster] : []));
    const filed = new Map(res.data.steps.flatMap((s) => (s.kind === "file" ? [[s.thoughtId, s.clusterId] as const] : [])));
    const linked = res.data.steps.flatMap((s) => (s.kind === "link" ? [s.link] : []));
    setClusters((list) => [...list, ...shelves.filter((s) => !list.some((c) => c.id === s.id))]);
    // Never over a bubble you placed yourself meanwhile.
    setThoughts((list) =>
      list.map((t) =>
        filed.has(t.id) && t.placedBy !== "you"
          ? { ...t, clusterId: filed.get(t.id) ?? null, placedBy: filed.get(t.id) == null ? null : ("bird" as PlacedBy) }
          : t,
      ),
    );
    setLinks((list) => [...list, ...linked.filter((l) => !list.some((x) => x.id === l.id))]);
    return res.data;
  }, [resyncLater]);

  const muse = useCallback(async (): Promise<Thought | null> => {
    const res = await api<Thought>("/api/bird/muse", { method: "POST" }, WORK_TIMEOUT_MS);
    if (!res.success) {
      resyncLater();
      return null;
    }
    setThoughts((list) => [...list, res.data]);
    return res.data;
  }, [resyncLater]);

  const suggest = useCallback(async (): Promise<Step | null> => {
    const res = await api<Step | null>("/api/bird/step", { method: "POST" }, WORK_TIMEOUT_MS);
    if (!res.success) {
      resyncLater();
      return null;
    }
    const step = res.data;
    if (step) setSteps((list) => (list.some((s) => s.id === step.id) ? list : [...list, step]));
    return step;
  }, [resyncLater]);

  const closeStep = useCallback(
    async (id: number, status: "done" | "dismissed") => {
      setSteps((list) => list.filter((s) => s.id !== id));
      const res = await api<Step>(`/api/steps/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!res.success) {
        flash(res.error);
        resync();
        return;
      }
      // The bird wants to hear about it: its question can be answered into a new bubble.
      if (status === "done") say(pick(STEP_DONE), 8);
    },
    [flash, resync, say],
  );

  // ---------- you, rearranging ----------

  const onMove = useCallback(
    async (id: number, clusterId: number | null, from: { clusterId: number | null; placedBy: PlacedBy | null }) => {
      const res = await api<Thought>(`/api/thoughts/${id}`, { method: "PATCH", body: JSON.stringify({ clusterId }) });
      if (!res.success) {
        world.current?.moveBubble(id, from.clusterId, from.placedBy);
        flash(res.error);
        resync();
        return;
      }
      setThoughts((list) => list.map((t) => (t.id === id ? res.data : t)));
    },
    // `world` is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flash, resync],
  );

  const onOpen = useCallback((id: number) => setOpenId(id), []);
  const onOpenCluster = useCallback((id: number) => setOpenShelf(id), []);
  const onOpenLink = useCallback((id: number) => setOpenLink(id), []);
  const { world, failed } = useWorld(canvas, initial, {
    greeting: hello,
    say,
    think,
    tidy,
    muse,
    suggest,
    resync,
    onOpen,
    onOpenCluster,
    onOpenLink,
    onMove,
  });

  resyncRef.current = () => {
    void api<Library>("/api/library").then((res) => {
      if (!res.success) return;
      setThoughts(res.data.thoughts);
      setClusters(res.data.clusters);
      setLinks(res.data.links);
      setSteps(res.data.steps);
      world.current?.sync(res.data);
    });
  };

  const changeShelf = useCallback(
    async (id: number, patch: { name?: string; color?: ShelfColor }) => {
      const res = await api<Cluster>(`/api/clusters/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.success) {
        flash(res.error);
        return;
      }
      setClusters((list) => list.map((c) => (c.id === id ? res.data : c)));
      world.current?.updateCluster(res.data);
    },
    [flash, world],
  );

  const popLink = useCallback(
    async (id: number) => {
      setOpenLink(null);
      const res = await api<{ id: number }>(`/api/links/${id}`, { method: "DELETE" });
      if (!res.success) {
        flash(res.error);
        return;
      }
      setLinks((list) => list.filter((l) => l.id !== id));
      world.current?.removeLink(id);
    },
    [flash, world],
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
      setLinks((list) => list.filter((l) => l.a !== id && l.b !== id));
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
  const shelf = openShelf === null ? null : (clusters.find((c) => c.id === openShelf) ?? null);
  const link: Link | null = openLink === null ? null : (links.find((l) => l.id === openLink) ?? null);
  const mine = thoughts.filter((t) => t.source !== "bird").length;
  const shelfOf = useMemo(() => {
    const names = new Map(clusters.filter((c) => c.kind === "shelf").map((c) => [c.id, c.name]));
    return new Map(thoughts.flatMap((t) => (t.clusterId !== null && names.has(t.clusterId) ? [[t.id, names.get(t.clusterId) as string]] : [])));
  }, [clusters, thoughts]);

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
      {mine > 0 && <p className="count">{mine === 1 ? "1 bubble" : `${mine} bubbles`}</p>}
      <StepsNote
        steps={steps}
        shelfOf={shelfOf}
        onDone={(id) => void closeStep(id, "done")}
        onDismiss={(id) => void closeStep(id, "dismissed")}
        onSource={(id) => thoughts.some((t) => t.id === id) && setOpenId(id)}
      />

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
      {open && (
        <Reader
          thought={open}
          shelf={clusters.find((c) => c.id === open.clusterId && c.kind === "shelf")?.name ?? null}
          onClose={close}
          onLetGo={onLetGo}
        />
      )}
      {shelf && (
        <ShelfCard
          shelf={shelf}
          count={thoughts.filter((t) => t.clusterId === shelf.id).length}
          onClose={() => setOpenShelf(null)}
          onChange={changeShelf}
          onForgot={resync}
        />
      )}
      {link && <LinkCard word={link.word} onClose={() => setOpenLink(null)} onPop={() => void popLink(link.id)} />}
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
