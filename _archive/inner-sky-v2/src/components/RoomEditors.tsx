"use client";

import { useState, useTransition } from "react";
import { addItemAction, setFocusAction } from "@/app/actions";
import type { RoomId } from "@/lib/rooms";

export function FocusEditor({ room, focus }: { room: RoomId; focus: string }) {
  const [value, setValue] = useState(focus);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <p className="hand" style={{ fontSize: "1.7rem", color: "var(--room)" }}>
          {focus || "No focus yet. What matters most here right now?"}
        </p>
        <button className="btn small" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="row">
      <input
        className="field"
        style={{ flex: 1, minWidth: 200 }}
        value={value}
        maxLength={300}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Room focus"
        autoFocus
      />
      <button
        className="light"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setFocusAction(room, value);
            if (res.success) setEditing(false);
          })
        }
      >
        Save
      </button>
    </div>
  );
}

export function AddItem({ room }: { room: RoomId }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    if (!title.trim()) return;
    startTransition(async () => {
      const res = await addItemAction({ room, title });
      if (res.success) {
        setTitle("");
        setError(null);
      } else setError(res.error ?? "Couldn't add.");
    });
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          className="field"
          placeholder="Add a step"
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="New item"
        />
        <button className="light" onClick={add} disabled={pending || !title.trim()}>
          Add
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
