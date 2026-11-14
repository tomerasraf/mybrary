"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveCheckin, writeEntryAction } from "@/app/actions";
import type { SkyNode } from "@/lib/sky/layout";
import { Constellation } from "./Constellation";

interface Props {
  readonly nodes: readonly SkyNode[];
  readonly greeting: string;
  readonly weatherLabel: string;
  readonly glow: string;
  readonly ink: string;
  readonly speed: number;
  readonly mood: number | null;
  readonly energy: number | null;
}

const KIND_NAME: Record<SkyNode["kind"], string> = {
  room: "a room",
  item: "a step",
  thought: "something you wrote",
  memory: "something Ember learned",
  place: "a place",
};

const OPEN_LABEL: Record<SkyNode["kind"], string> = {
  room: "Open room",
  item: "Open room",
  thought: "Read in diary",
  memory: "See your profile",
  place: "See on the map",
};

function Dial({ label, value, onPick }: { label: string; value: number | null; onPick: (v: number) => void }) {
  return (
    <div className="dial-group" role="group" aria-label={label}>
      <span className="hand" style={{ fontSize: "1.3rem", minWidth: 58 }}>
        {label}
      </span>
      {[1, 2, 3, 4, 5].map((v) => (
        <button
          key={v}
          type="button"
          className="dial-dot"
          data-on={value !== null && v <= value}
          aria-pressed={value === v}
          aria-label={`${label} ${v} of 5`}
          onClick={() => onPick(v)}
        />
      ))}
    </div>
  );
}

export function NowView(props: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<SkyNode | null>(null);
  const [thought, setThought] = useState("");
  const [mood, setMood] = useState(props.mood);
  const [energy, setEnergy] = useState(props.energy);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function drop() {
    const body = thought.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await writeEntryAction({ body, mood: null });
      if (res.success) {
        setThought("");
        router.refresh();
      } else setError(res.error ?? "Couldn't save that.");
    });
  }

  function pick(kind: "mood" | "energy", value: number) {
    const nextMood = kind === "mood" ? value : mood;
    const nextEnergy = kind === "energy" ? value : energy;
    if (kind === "mood") setMood(value);
    else setEnergy(value);
    if (nextMood === null || nextEnergy === null) return; // wait for both
    startTransition(async () => {
      const res = await saveCheckin({ mood: nextMood, energy: nextEnergy, note: "" });
      if (res.success) router.refresh();
      else setError(res.error ?? "Couldn't save your check-in.");
    });
  }

  const empty = props.nodes.every((n) => n.kind === "room");

  return (
    <>
      <Constellation
        nodes={props.nodes}
        glow={props.glow}
        ink={props.ink}
        speed={props.speed}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
      />

      <header className="now-top">
        <h1>{props.greeting}</h1>
        <p className="now-weather">
          {mood === null || energy === null ? "How's the weather in there today?" : `${props.weatherLabel} in here today.`}
        </p>
      </header>

      {selected && (
        <aside className="node-card veil" aria-live="polite">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <span className="kind">{KIND_NAME[selected.kind]}</span>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
              ✕
            </button>
          </div>
          {selected.kind !== "thought" && <h3>{selected.label}</h3>}
          {(selected.detail || selected.kind === "thought") && (
            <p className={selected.kind === "thought" ? "hand" : "dim"}>{selected.detail || selected.label}</p>
          )}
          <Link className="btn" href={selected.href} style={{ alignSelf: "flex-start" }}>
            {OPEN_LABEL[selected.kind]}
          </Link>
        </aside>
      )}

      {empty && !selected && (
        <p className="now-hint" style={{ bottom: "auto", top: "45%", right: "auto", left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
          Your sky is empty. Write the first thing on your mind below.
        </p>
      )}
      {!empty && <p className="now-hint">drag to turn the sky, tap a light to open it</p>}

      <section className="now-panel" aria-label="Today">
        <div className="dial">
          <Dial label="mood" value={mood} onPick={(v) => pick("mood", v)} />
          <Dial label="energy" value={energy} onPick={(v) => pick("energy", v)} />
        </div>
        <div className="now-drop">
          <input
            value={thought}
            maxLength={2000}
            placeholder="drop a thought into the sky…"
            aria-label="Write a thought"
            onChange={(e) => setThought(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && drop()}
          />
          <button className="light" onClick={drop} disabled={pending || !thought.trim()}>
            Release
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}
