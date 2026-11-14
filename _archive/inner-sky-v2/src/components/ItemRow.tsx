"use client";

import { useTransition } from "react";
import { deleteItemAction, moveItemAction, setNextAction, toggleItemAction } from "@/app/actions";
import type { Item } from "@/lib/repo/items";
import { ROOMS } from "@/lib/rooms";

export function ItemRow({ item, showMove = false }: { item: Item; showMove?: boolean }) {
  const [pending, startTransition] = useTransition();
  const done = item.status === "done";
  const run = (fn: () => Promise<unknown>) => startTransition(async () => void (await fn()));

  return (
    <div className={`line${done ? " done" : ""}`} style={{ opacity: pending ? 0.55 : 1 }}>
      <input
        type="checkbox"
        className="bulb"
        checked={done}
        aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`}
        onChange={(e) => run(() => toggleItemAction(item.id, e.target.checked))}
      />
      <div className="line-body">
        <span className="line-title">{item.title}</span>
        {item.kind !== "task" && <span className="star-mark">{item.kind}</span>}
        {item.isNext && !done && <span className="star-mark">next step</span>}
        {item.detail && <p className="small dim">{item.detail}</p>}
        {showMove && (
          <select
            className="field small"
            style={{ marginTop: 4, maxWidth: 240 }}
            defaultValue=""
            aria-label="Move to room"
            onChange={(e) => e.target.value && run(() => moveItemAction(item.id, e.target.value))}
          >
            <option value="" disabled>
              Move to a room
            </option>
            {ROOMS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!done && !item.isNext && item.room && (
        <button className="icon-btn" title="Make this the next step" aria-label="Make this the next step" onClick={() => run(() => setNextAction(item.id))}>
          ✦
        </button>
      )}
      <button className="icon-btn" title="Delete" aria-label={`Delete ${item.title}`} onClick={() => run(() => deleteItemAction(item.id))}>
        ✕
      </button>
    </div>
  );
}
