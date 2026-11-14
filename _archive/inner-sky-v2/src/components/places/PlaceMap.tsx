"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/repo/places";

export interface Draft {
  readonly lat: number;
  readonly lng: number;
  readonly name: string;
}

interface Props {
  readonly places: readonly Place[];
  readonly colors: Readonly<Record<string, string>>;
  readonly draft: Draft | null;
  readonly focus: { lat: number; lng: number; key: number } | null;
  readonly selectedId: number | null;
  readonly onMapClick: (lat: number, lng: number) => void;
  readonly onPlaceClick: (id: number) => void;
}

const RAMAT_GAN: [number, number] = [32.0823, 34.8106];
// OpenStreetMap's standard tiles; globals.css turns them into a mood-tinted night map.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function pinIcon(L: typeof Leaflet, color: string, cls: string): Leaflet.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="pin ${cls}" style="--pin:${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export default function PlaceMap({ places, colors, draft, focus, selectedId, onMapClick, onPlaceClick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const libRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const draftRef = useRef<Leaflet.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onMapClick, onPlaceClick });
  handlers.current = { onMapClick, onPlaceClick };

  // Leaflet touches `window`, so it is loaded only in the browser.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !hostRef.current || mapRef.current) return;
      libRef.current = L;
      const map = L.map(hostRef.current, { zoomControl: false, attributionControl: true }).setView(RAMAT_GAN, 13);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
      map.on("click", (e: Leaflet.LeafletMouseEvent) => handlers.current.onMapClick(e.latlng.lat, e.latlng.lng));
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Markers
  useEffect(() => {
    const L = libRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
      for (const p of places) {
        if (p.lat == null || p.lng == null) continue;
        const marker = L.marker([p.lat, p.lng], {
          icon: pinIcon(L, colors[p.category] ?? "#fff", `${p.status}${p.id === selectedId ? " selected" : ""}`),
          title: p.name,
          keyboard: true,
          zIndexOffset: p.id === selectedId ? 1000 : 0,
        });
        // Leaflet renders string content as HTML; a text node keeps names inert.
        const tip = document.createElement("span");
        tip.textContent = p.name;
        marker.bindTooltip(tip, { direction: "top", offset: [0, -10] });
        marker.on("click", () => handlers.current.onPlaceClick(p.id));
        marker.addTo(layer);
      }
  }, [ready, places, colors, selectedId]);

  // Draft pin
  useEffect(() => {
    const L = libRef.current;
    const map = mapRef.current;
    draftRef.current?.remove();
    draftRef.current = null;
    if (!ready || !L || !map || !draft) return;
    draftRef.current = L.marker([draft.lat, draft.lng], { icon: pinIcon(L, "#fff", "draft"), interactive: false }).addTo(map);
  }, [ready, draft]);

  // Fly to a searched / selected spot
  useEffect(() => {
    const map = mapRef.current;
    if (ready && focus && map) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [ready, focus]);

  return <div ref={hostRef} className="map" role="application" aria-label="Map of your places" />;
}
