"use client";

import { useEffect, useRef, useState } from "react";
import { THOUGHT_MAX, type ThoughtSource } from "@/lib/thoughts";
import { useSpeech } from "./useSpeech";

interface Props {
  busy: boolean;
  /** The bird's latest question you can still answer. */
  question: string | null;
  /** The question you're answering right now. */
  replyTo: string | null;
  onReply: (question: string | null) => void;
  /** You don't want this question. */
  onSkip: (question: string) => void;
  /** Something just for the bird: it remembers it, and no bubble is made. */
  onTell: (text: string, about: string | null) => Promise<boolean>;
  onComposing: (value: boolean) => void;
  onKeystroke: (textLength: number) => void;
  onRelease: (text: string, source: ThoughtSource) => Promise<boolean>;
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" ").replace(/\s+\n/g, "\n");

export function Composer({ busy, question, replyTo, onReply, onSkip, onTell, onComposing, onKeystroke, onRelease }: Props) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [spoken, setSpoken] = useState(false);
  /** Talking to the bird itself: what you write goes into its memory, not into the world. */
  const [whisper, setWhisper] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const before = useRef("");
  const heard = useRef(0);

  const speech = useSpeech((settled, guessing) => {
    const next = join(before.current, settled, guessing);
    // Every few new letters, the bird hits a key.
    const grown = next.length - heard.current;
    if (grown > 0) {
      for (let i = 0; i < Math.min(4, Math.ceil(grown / 6)); i++) setTimeout(() => onKeystroke(next.length), i * 70);
    }
    heard.current = next.length;
    setText(next);
    setSpoken(true);
  });

  /** In whisper mode, a question is something to answer; anything else is something to remember. */
  const asking = whisper && text.trim().endsWith("?");
  const active = focused || speech.listening || text.length > 0 || replyTo !== null || whisper;

  useEffect(() => {
    if (replyTo) area.current?.focus();
  }, [replyTo]);
  useEffect(() => onComposing(active), [active, onComposing]);

  // Grow the box with the text.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  function toggleMic() {
    if (speech.listening) {
      speech.stop();
      return;
    }
    before.current = text.trim();
    heard.current = text.length;
    speech.start();
  }

  async function release() {
    const body = text.trim();
    if (!body || busy) return;
    if (speech.listening) speech.stop();
    const ok = whisper ? await onTell(body, question) : await onRelease(body, spoken ? "spoken" : "written");
    if (!ok) return;
    setWhisper(false);
    setText("");
    setSpoken(false);
    area.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (!coarse && !e.shiftKey))) {
      e.preventDefault();
      void release();
    } else if (e.key === "Escape") area.current?.blur();
  }

  return (
    <form
      className="composer"
      data-active={active || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void release();
      }}
    >
      {whisper ? (
        <p className="reply-chip whisper-chip" dir="auto">
          <span className="reply-label">{question && !asking ? "just for the bird, about" : "just for the bird"}</span>
          <span className="reply-q">
            {asking ? "it answers from what you've told it. no bubble." : (question ?? "tell it something, or ask it about what you've said. no bubble.")}
          </span>
          <button type="button" className="reply-x" aria-label="Stop talking to the bird" onClick={() => setWhisper(false)}>
            ×
          </button>
        </p>
      ) : replyTo ? (
        <p className="reply-chip" dir="auto">
          <span className="reply-label">answering</span>
          <span className="reply-q">{replyTo}</span>
          <button type="button" className="reply-x" aria-label="Don't answer" onClick={() => onReply(null)}>
            ×
          </button>
        </p>
      ) : (
        question &&
        !text && (
          <p className="reply-chip reply-offer" dir="auto">
            <button type="button" className="reply-pick" onClick={() => onReply(question)}>
              <span className="reply-label">answer him</span>
              <span className="reply-q">{question}</span>
            </button>
            <button type="button" className="reply-x" aria-label="Not this question" title="not this one" onClick={() => onSkip(question)}>
              ×
            </button>
          </p>
        )
      )}
      <textarea
        ref={area}
        rows={1}
        dir="auto"
        value={text}
        maxLength={THOUGHT_MAX}
        placeholder={speech.listening ? "listening…" : whisper ? "tell the bird, or ask it…" : replyTo ? "tell him…" : "what's on your mind?"}
        aria-label={whisper ? "Something just for the bird" : "A new thought"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const v = e.target.value;
          if (v.length > text.length) onKeystroke(v.length);
          setText(v);
        }}
      />
      <button
        type="button"
        className="round whisper"
        data-on={whisper || undefined}
        aria-pressed={whisper}
        aria-label="Talk to the bird: tell it something or ask it, without making a bubble"
        title="talk to the bird (no bubble)"
        onClick={() => {
          if (!whisper) onReply(null);
          setWhisper(!whisper);
          area.current?.focus();
        }}
      >
        <BirdIcon />
      </button>
      {speech.supported && (
        <button
          type="button"
          className="round mic"
          data-on={speech.listening || undefined}
          aria-pressed={speech.listening}
          aria-label={speech.listening ? "Stop listening" : "Talk"}
          onClick={toggleMic}
        >
          <MicIcon />
        </button>
      )}
      <button type="submit" className="round send" disabled={!text.trim() || busy} aria-label={asking ? "Ask the bird" : whisper ? "Tell the bird" : "Let it become a bubble"}>
        <UpIcon />
      </button>
      {speech.error && <p className="composer-note">{speech.error}</p>}
    </form>
  );
}

function BirdIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="12" r="6.5" />
      <path d="M17 10.5l4 1.5-4 1.5" />
      <circle cx="9" cy="11" r="1.6" />
      <circle cx="13.6" cy="11" r="1.6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
