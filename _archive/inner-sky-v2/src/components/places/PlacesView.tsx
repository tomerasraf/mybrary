"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { addPlaceAction, deletePlaceAction, setPlaceLocationAction, setPlaceStatusAction } from "@/app/actions";
import { PLACE_CATEGORIES, PLACE_STATUSES, type PlaceCategory, type PlaceStatus } from "@/lib/constants";
import type { Place } from "@/lib/repo/places";
import type { Draft } from "./PlaceMap";

const PlaceMap = dynamic(() => import("./PlaceMap"), { ssr: false });

const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  meet: "Meet people",
  train: "Train",
  buy: "Buy things",
  food: "Eat",
  coffee: "Coffee & work",
  nature: "Outdoors",
  nightlife: "Night out",
  learn: "Learn",
  culture: "Culture",
  other: "Other",
};

const STATUS_LABEL: Record<PlaceStatus, string> = { want: "want to go", been: "been there", loved: "loved it" };

interface SearchHit {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

export function PlacesView({ places, colors }: { places: readonly Place[]; colors: Readonly<Record<string, string>> }) {
  const [hidden, setHidden] = useState<ReadonlySet<PlaceCategory>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<{ name: string; category: PlaceCategory; notes: string }>({
    name: "",
    category: "meet",
    notes: "",
  });
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => places.filter((p) => !hidden.has(p.category)), [places, hidden]);
  const unpinned = places.filter((p) => p.lat == null);

  function toggleCategory(c: PlaceCategory) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function onMapClick(lat: number, lng: number) {
    if (pinningId !== null) {
      const id = pinningId;
      setPinningId(null);
      startTransition(async () => {
        const res = await setPlaceLocationAction(id, lat, lng);
        setMessage(res.success ? "Pinned." : (res.error ?? "Couldn't pin it."));
      });
      return;
    }
    setDraft({ lat, lng, name: "" });
    setSelectedId(null);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      const body = (await res.json()) as { success: boolean; data?: SearchHit[]; error?: string };
      if (!body.success) setMessage(body.error ?? "Search failed.");
      else if (!body.data?.length) setMessage(`No match for "${query}". Try tapping the map instead.`);
      setHits(body.data ?? []);
    } catch {
      setMessage("Search failed. Tap the map to drop a pin instead.");
    }
  }

  function chooseHit(hit: SearchHit) {
    setHits([]);
    setDraft({ lat: hit.lat, lng: hit.lng, name: hit.name });
    setForm((f) => ({ ...f, name: hit.name }));
    setFocus({ lat: hit.lat, lng: hit.lng, key: Date.now() });
  }

  function save() {
    if (!form.name.trim()) return;
    startTransition(async () => {
      const res = await addPlaceAction({ ...form, area: "", lat: draft?.lat ?? null, lng: draft?.lng ?? null });
      if (res.success) {
        setDraft(null);
        setForm((f) => ({ name: "", category: f.category, notes: "" }));
        setMessage(`Added ${form.name}.`);
      } else setMessage(res.error ?? "Couldn't add it.");
    });
  }

  function selectPlace(p: Place) {
    setSelectedId(p.id);
    if (p.lat != null && p.lng != null) setFocus({ lat: p.lat, lng: p.lng, key: Date.now() });
  }

  const selected = places.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <div className="legend" role="group" aria-label="Show categories">
        {PLACE_CATEGORIES.map((c) => (
          <button key={c} aria-pressed={!hidden.has(c)} onClick={() => toggleCategory(c)} style={{ ["--pin" as string]: colors[c] }}>
            <i aria-hidden />
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="map-wrap">
        <PlaceMap
          places={visible}
          colors={colors}
          draft={draft}
          focus={focus}
          selectedId={selectedId}
          onMapClick={onMapClick}
          onPlaceClick={(id) => setSelectedId(id)}
        />
        <form className="map-search" onSubmit={search} role="search">
          <div className="now-drop" style={{ padding: "4px 4px 4px 14px" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={pinningId !== null ? "tap the map to pin it…" : "search a place, or tap the map"}
              aria-label="Search places"
              style={{ fontSize: "1.25rem" }}
            />
            <button className="btn" type="submit">
              Find
            </button>
          </div>
          {hits.length > 0 && (
            <div className="map-search-results">
              {hits.map((h) => (
                <button key={`${h.lat},${h.lng}`} type="button" onClick={() => chooseHit(h)}>
                  <strong>{h.name}</strong>
                  <span className="dim small" style={{ display: "block" }}>
                    {h.address}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>
      </div>
      {message && <p className="whisper">{message}</p>}

      <div className="split">
        <section className="section" aria-labelledby="add-title">
          <div className="section-head">
            <h2 id="add-title">{draft ? "New pin" : "Add a place"}</h2>
            {draft && (
              <button className="btn small" onClick={() => setDraft(null)}>
                Remove pin
              </button>
            )}
          </div>
          {!draft && <p className="dim">Tap the map or search above to drop a pin. You can also add a place without one.</p>}
          <input
            className="field"
            placeholder="Name"
            value={form.name}
            maxLength={200}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Place name"
          />
          <select
            className="field"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as PlaceCategory })}
            aria-label="What it's for"
          >
            {PLACE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <input
            className="field"
            placeholder="Why it's on your map (optional)"
            value={form.notes}
            maxLength={1000}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            aria-label="Notes"
          />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link className="btn" href={`/ember?q=${encodeURIComponent("Find me a few real places near Ramat Gan that fit what you know about me — somewhere to meet people, a place to train, and a good spot to buy groceries.")}`}>
              Ask Ember for ideas
            </Link>
            <button className="light" onClick={save} disabled={pending || !form.name.trim()}>
              Add to map
            </button>
          </div>
        </section>

        <section className="section" aria-labelledby="list-title">
          <div className="section-head">
            <h2 id="list-title">Your places</h2>
            <span className="dim small">{places.length}</span>
          </div>
          {selected && (
            <div className="veil stack">
              <h3>{selected.name}</h3>
              <p className="dim small">
                {CATEGORY_LABEL[selected.category]}
                {selected.notes ? `, ${selected.notes}` : ""}
              </p>
              <div className="row">
                {PLACE_STATUSES.map((s) => (
                  <button
                    key={s}
                    className="btn small"
                    aria-pressed={selected.status === s}
                    style={selected.status === s ? { color: "var(--glow)" } : undefined}
                    onClick={() => startTransition(async () => void (await setPlaceStatusAction(selected.id, s)))}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="row">
                <a
                  className="btn small"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={
                    selected.lat != null
                      ? `https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.name)}`
                  }
                >
                  Directions
                </a>
                <button
                  className="btn small"
                  onClick={() => {
                    if (window.confirm(`Remove ${selected.name} from your map?`)) {
                      setSelectedId(null);
                      startTransition(async () => void (await deletePlaceAction(selected.id)));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          )}
          {places.length === 0 && <p className="empty">No places yet. Start with where you train or buy groceries.</p>}
          <div>
            {places.map((p) => (
              <div key={p.id} className="line" style={{ ["--pin" as string]: colors[p.category] }}>
                <span className={`pin ${p.status}`} style={{ marginTop: 4, width: 12, height: 12 }} aria-hidden />
                <button
                  className="line-body"
                  style={{ appearance: "none", background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}
                  onClick={() => selectPlace(p)}
                >
                  <span className="line-title">{p.name}</span>
                  <span className="dim small" style={{ display: "block" }}>
                    {CATEGORY_LABEL[p.category]}, {STATUS_LABEL[p.status]}
                  </span>
                </button>
                {p.lat == null && (
                  <button className="btn small" onClick={() => setPinningId(p.id)}>
                    {pinningId === p.id ? "Tap the map" : "Pin it"}
                  </button>
                )}
              </div>
            ))}
          </div>
          {unpinned.length > 0 && <p className="dim small">{unpinned.length} not on the map yet.</p>}
        </section>
      </div>
    </>
  );
}
