"use client";

import { useState, useTransition } from "react";
import { addMemoryAction, deleteMemoryAction, reflectAction, updateMemoryAction } from "@/app/actions";
import { MEMORY_CATEGORIES, type MemoryCategory } from "@/lib/constants";
import type { Memory } from "@/lib/repo/memories";

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  about: "About you",
  habit: "Habits",
  belief: "Beliefs",
  preference: "Likes and dislikes",
  goal: "Goals",
  win: "Wins",
  struggle: "Struggles",
};

function MemoryRow({ memory }: { memory: Memory }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.fact);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <div className="row line" style={{ flexWrap: "nowrap" }}>
        <input className="field" value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} autoFocus />
        <button
          className="btn small"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateMemoryAction(memory.id, value);
              if (res.success) setEditing(false);
            })
          }
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div className="line" style={{ opacity: pending ? 0.5 : 1 }}>
      <p className="line-body">{memory.fact}</p>
      <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>
        ✎
      </button>
      <button
        className="icon-btn"
        title="Forget this"
        onClick={() => startTransition(async () => void (await deleteMemoryAction(memory.id)))}
      >
        ✕
      </button>
    </div>
  );
}

export function MemoryBoard({ memories, aiReady }: { memories: readonly Memory[]; aiReady: boolean }) {
  const [fact, setFact] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("about");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reflectNow() {
    setNote(null);
    startTransition(async () => {
      const res = await reflectAction();
      setNote(res.success && res.data ? res.data.summary : (res.error ?? "Reflection failed."));
    });
  }

  function add() {
    startTransition(async () => {
      const res = await addMemoryAction({ fact, category });
      if (res.success) setFact("");
      else setNote(res.error ?? "Couldn't save that.");
    });
  }

  const groups = MEMORY_CATEGORIES.map((c) => ({ c, items: memories.filter((m) => m.category === c) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <section className="section" aria-labelledby="mem-title">
      <div className="section-head">
        <h2 id="mem-title">What Ember knows about you</h2>
        <button className="light" onClick={reflectNow} disabled={pending || !aiReady}>
          {pending ? "Reflecting…" : "Reflect now"}
        </button>
      </div>
      <p className="dim small" style={{ maxWidth: "60ch" }}>
        Ember updates this when it reflects on your check-ins and chats. You can edit or delete anything — it&apos;s
        yours.
      </p>
      {note && <p className="whisper">{note}</p>}

      {groups.length === 0 && (
        <p className="empty">Nothing yet. Write in your diary for a few days, then press Reflect now.</p>
      )}
      {groups.map((g) => (
        <div key={g.c}>
          <h3 style={{ marginTop: 10, color: "var(--glow)" }}>{CATEGORY_LABEL[g.c]}</h3>
          {g.items.map((m) => (
            <MemoryRow key={m.id} memory={m} />
          ))}
        </div>
      ))}

      <div className="row" style={{ flexWrap: "nowrap" }}>
        <select
          className="field"
          style={{ width: "auto" }}
          value={category}
          onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          aria-label="Category"
        >
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          className="field"
          placeholder="Tell Ember something about you"
          value={fact}
          maxLength={500}
          onChange={(e) => setFact(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fact.trim() && add()}
        />
        <button className="light" onClick={add} disabled={pending || !fact.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}
