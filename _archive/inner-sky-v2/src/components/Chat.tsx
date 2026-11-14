"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { clearChatAction, reflectAction } from "@/app/actions";
import { Markdown } from "./Markdown";

interface Msg {
  readonly role: "user" | "assistant";
  readonly content: string;
}

const SEARCH_MARKER = "\u0000searching\u0000";

const STARTERS = [
  "I'm feeling scattered. Help me pick one thing for tonight.",
  "What's something fun to do in Ramat Gan or Tel Aviv this weekend?",
  "Where can I meet new people around here?",
  "Plan my week so every room gets a little love.",
];

export function Chat({ initial, starter, aiReady }: { initial: Msg[]; starter: string; aiReady: boolean }) {
  const [messages, setMessages] = useState<readonly Msg[]>(initial);
  const [input, setInput] = useState(starter);
  const [streaming, setStreaming] = useState(false);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;
    setInput("");
    setNote(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: "" }]);

    const updateLast = (content: string) =>
      setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: "Ember couldn't answer." }));
        updateLast(body.error ?? "Ember couldn't answer.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (acc.includes(SEARCH_MARKER)) {
          setSearching(true);
          acc = acc.split(SEARCH_MARKER).join("");
        }
        updateLast(acc);
      }
    } catch {
      updateLast("Lost the connection to Ember. Send it again.");
    } finally {
      setStreaming(false);
      setSearching(false);
    }
  }

  function learn() {
    setNote(null);
    startTransition(async () => {
      const res = await reflectAction();
      setNote(
        res.success && res.data
          ? `${res.data.summary} (${res.data.added} new insight${res.data.added === 1 ? "" : "s"})`
          : (res.error ?? "Reflection failed."),
      );
    });
  }

  function clear() {
    startTransition(async () => {
      await clearChatAction();
      setMessages([]);
    });
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="dim small">Ember reads your diary, rooms and check-ins, and remembers what it learns.</p>
        <div className="row">
          <button className="btn small" onClick={learn} disabled={pending || !aiReady} title="Ember reflects and updates what it knows about you">
            {pending ? "Reflecting…" : "Learn from this"}
          </button>
          {messages.length > 0 && (
            <button className="btn small" onClick={clear} disabled={pending || streaming}>
              Clear
            </button>
          )}
        </div>
      </div>
      {note && <p className="whisper">{note}</p>}

      <div className="chat" aria-live="polite">
        {messages.length === 0 && (
          <div className="stack">
            <p className="whisper" style={{ fontSize: "1.8rem" }}>Hey. I&apos;m here. What&apos;s on your mind?</p>
            <div className="stack" style={{ alignItems: "flex-start", gap: 4 }}>
              {STARTERS.map((s) => (
                <button key={s} className="btn" style={{ whiteSpace: "normal", textAlign: "left", fontWeight: 400 }} onClick={() => send(s)} disabled={!aiReady}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "msg-user" : "msg-ember"}>
            {m.content ? (
              m.role === "assistant" ? <Markdown text={m.content} /> : m.content
            ) : (
              <span className="row small dim">
                <span className="typing" aria-label="Ember is typing">
                  <span />
                  <span />
                  <span />
                </span>
                {searching && "looking things up…"}
              </span>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          rows={1}
          placeholder={aiReady ? "Talk to Ember…" : "Add ANTHROPIC_API_KEY to .env.local to wake Ember"}
          value={input}
          maxLength={8000}
          disabled={!aiReady}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          aria-label="Message Ember"
        />
        <button className="light" onClick={() => send(input)} disabled={streaming || !input.trim() || !aiReady}>
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </>
  );
}
