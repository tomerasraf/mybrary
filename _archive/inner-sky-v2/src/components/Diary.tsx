"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteEntryAction, extractTasksAction, updateEntryAction, writeEntryAction } from "@/app/actions";
import type { DiaryEntry } from "@/lib/repo/diary";

const FACES = ["low", "meh", "okay", "good", "great"] as const;

export function DiaryPage({ prompt }: { prompt: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await writeEntryAction({ body, mood });
      if (res.success) {
        setBody("");
        setMood(null);
        router.refresh();
      } else setError(res.error ?? "Couldn't save.");
    });
  }

  return (
    <div className="paper">
      <textarea
        value={body}
        placeholder={prompt}
        maxLength={20000}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        aria-label="Diary entry"
      />
      <div className="paper-foot">
        <div className="face-row" role="group" aria-label="How do you feel? (optional)">
          {FACES.map((f, i) => (
            <button
              key={f}
              type="button"
              className="face"
              aria-pressed={mood === i + 1}
              onClick={() => setMood(mood === i + 1 ? null : i + 1)}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="light" onClick={save} disabled={pending || !body.trim()}>
          {pending ? "Saving…" : "Save entry"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function time(createdAt: string): string {
  const d = new Date(`${createdAt.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
}

export function EntryView({ entry, aiReady }: { entry: DiaryEntry; aiReady: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.body);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pullTasks() {
    setNote(null);
    startTransition(async () => {
      const res = await extractTasksAction(entry.id);
      setNote(res.success && res.data ? res.data.reply : (res.error ?? "Couldn't read that entry."));
    });
  }

  return (
    <article className="entry" id={`entry-${entry.id}`} style={{ opacity: pending ? 0.6 : 1 }}>
      {editing ? (
        <>
          <textarea className="field" rows={6} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button
              className="btn"
              onClick={() =>
                startTransition(async () => {
                  const res = await updateEntryAction(entry.id, text);
                  if (res.success) setEditing(false);
                })
              }
            >
              Save changes
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className="entry-body">{entry.body}</p>
      )}
      <div className="entry-meta">
        <span>{time(entry.createdAt)}</span>
        {entry.mood && <span className="hand">feeling {FACES[entry.mood - 1]}</span>}
        <button className="btn small" onClick={pullTasks} disabled={pending || !aiReady} title="Ember turns the actionable parts into steps in your rooms">
          Pull out tasks
        </button>
        {!editing && (
          <button className="btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button
          className="btn small"
          onClick={() => {
            if (window.confirm("Delete this entry? It can't be undone.")) {
              startTransition(async () => void (await deleteEntryAction(entry.id)));
            }
          }}
        >
          Delete
        </button>
      </div>
      {note && <p className="whisper">{note}</p>}
    </article>
  );
}
