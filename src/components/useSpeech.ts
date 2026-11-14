"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings: the Web Speech API is not in every TypeScript DOM lib yet.
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0?: { transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it in the browser to talk.",
  "service-not-allowed": "This browser won't let me listen here. On a phone, open the app over https.",
  "audio-capture": "I can't find a microphone.",
  network: "Voice needs an internet connection.",
};

export interface Speech {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Voice to text with the browser's own speech recognition.
 * `onText` gets everything heard this session: the settled part and the part still being guessed.
 */
export function useSpeech(onText: (settled: string, guessing: string) => void): Speech {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const settled = useRef("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => setSupported(getCtor() !== null), []);

  const begin = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let guess = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) settled.current = `${settled.current} ${text}`.trim();
        else guess += text;
      }
      onTextRef.current(settled.current, guess.trim());
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(ERRORS[e.error] ?? "I couldn't hear that. Try again?");
      wanted.current = false;
    };
    // Browsers stop listening after a pause; keep going until the person says stop.
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
          return;
        } catch {
          wanted.current = false;
        }
      }
      setListening(false);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("I couldn't start listening. Try again?");
    }
  }, []);

  const start = useCallback(() => {
    setError(null);
    settled.current = "";
    wanted.current = true;
    begin();
  }, [begin]);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  return { supported, listening, error, start, stop };
}
