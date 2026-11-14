"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { nodePosition, nodeSize, type SkyNode } from "@/lib/sky/layout";

interface Props {
  readonly nodes: readonly SkyNode[];
  readonly glow: string;
  readonly ink: string;
  readonly speed: number; // from energy
  readonly selectedId: string | null;
  readonly onSelect: (node: SkyNode | null) => void;
}

interface Entry {
  node: SkyNode;
  sprite: THREE.Sprite;
  label: HTMLDivElement | null;
  base: THREE.Vector3;
  phase: number;
  spawnAt: number; // ms timestamp, 0 = no spawn animation
}

interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  core: THREE.Sprite;
  lines: THREE.LineSegments;
  floor: THREE.PolarGridHelper;
  texture: THREE.Texture;
  entries: Map<string, Entry>;
  labels: HTMLDivElement;
  hovered: string | null;
  synced: boolean;
}

const INTRO_MS = 2600;
const SPAWN_MS = 1400;
const CAMERA_HOME = new THREE.Vector3(0, 4.5, 19);
const CAMERA_INTRO = new THREE.Vector3(0, 46, 78);

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Which labels are always visible, and up to what camera distance. */
const LABEL_RANGE: Record<SkyNode["kind"], number> = {
  room: Infinity,
  thought: 60,
  place: 26,
  item: 17,
  memory: 0, // only on hover
};

function makeFloor(ink: string): THREE.PolarGridHelper {
  const floor = new THREE.PolarGridHelper(13, 12, 6, 96, new THREE.Color(ink), new THREE.Color(ink));
  floor.position.y = -6.5;
  const material = floor.material as THREE.Material;
  material.transparent = true;
  material.opacity = 0.09;
  return floor;
}

function makeLabel(node: SkyNode, layer: HTMLDivElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `node-label ${node.kind}`;
  el.textContent = node.label;
  if (node.kind === "room") el.style.color = node.color;
  el.style.opacity = "0";
  layer.appendChild(el);
  return el;
}

export function Constellation({ nodes, glow, ink, speed, selectedId, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  const speedRef = useRef(speed);
  onSelectRef.current = onSelect;
  selectedRef.current = selectedId;
  speedRef.current = speed;

  // ---- one-time scene setup ----
  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      console.error("[constellation] WebGL unavailable", error);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    camera.position.copy(still ? CAMERA_HOME : CAMERA_INTRO);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 60;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.18 * speed;
    controls.enabled = still;

    const texture = glowTexture();

    // You, at the centre: a lamp that breathes with your energy.
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color(glow),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    core.scale.setScalar(4.2);
    scene.add(core);

    // The map floor where places live.
    const floor = makeFloor(ink);
    scene.add(floor);

    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(ink),
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(lines);

    const world: World = {
      renderer,
      scene,
      camera,
      controls,
      core,
      lines,
      floor,
      texture,
      entries: new Map(),
      labels,
      hovered: null,
      synced: false,
    };
    worldRef.current = world;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.fov = w < 700 ? 68 : 55;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ---- picking ----
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-10, -10);
    let down: { x: number; y: number } | null = null;
    const toNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const pick = (): Entry | null => {
      raycaster.setFromCamera(pointer, camera);
      const sprites = [...world.entries.values()].map((e) => e.sprite);
      const hit = raycaster.intersectObjects(sprites, false)[0];
      return hit ? ([...world.entries.values()].find((e) => e.sprite === hit.object) ?? null) : null;
    };
    const onMove = (e: PointerEvent) => {
      toNdc(e);
      const entry = pick();
      world.hovered = entry?.node.id ?? null;
      renderer.domElement.style.cursor = entry ? "pointer" : "grab";
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      controls.autoRotate = false;
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
        toNdc(e);
        onSelectRef.current(pick()?.node ?? null);
      }
      down = null;
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // ---- animation ----
    const tmp = new THREE.Vector3();
    const startedAt = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const t = (now - startedAt) / 1000;

      if (!still && now - startedAt < INTRO_MS) {
        const k = easeInOut((now - startedAt) / INTRO_MS);
        camera.position.lerpVectors(CAMERA_INTRO, CAMERA_HOME, k);
        camera.lookAt(0, 0, 0);
      } else if (!controls.enabled) {
        controls.enabled = true;
      }
      controls.update();

      core.scale.setScalar(4.2 + (still ? 0 : Math.sin(t * 1.4 * speedRef.current) * 0.35));

      const w = host.clientWidth;
      const h = host.clientHeight;
      const camDist = camera.position.length();
      for (const entry of world.entries.values()) {
        const { node, sprite, base, phase } = entry;
        const bob = still ? 0 : Math.sin(t * 0.6 + phase) * 0.18;
        if (entry.spawnAt) {
          const k = Math.min(1, (now - entry.spawnAt) / SPAWN_MS);
          sprite.position.lerpVectors(core.position, base, easeOutBack(k));
          if (k >= 1) entry.spawnAt = 0;
        } else {
          sprite.position.set(base.x, base.y + bob, base.z);
        }
        const active = world.hovered === node.id || selectedRef.current === node.id;
        const size = nodeSize(node) * (active ? 1.7 : 1);
        sprite.scale.setScalar(sprite.scale.x + (size - sprite.scale.x) * 0.2);

        const label = entry.label;
        if (!label) continue;
        tmp.copy(sprite.position).project(camera);
        const d = camera.position.distanceTo(sprite.position);
        const inRange = d < LABEL_RANGE[node.kind] || active;
        if (tmp.z > 1 || !inRange) {
          label.style.opacity = "0";
          continue;
        }
        const x = (tmp.x * 0.5 + 0.5) * w;
        const y = (-tmp.y * 0.5 + 0.5) * h;
        const fade = node.kind === "room" ? 1 : Math.max(0, Math.min(1, 1.5 - d / (camDist + 6)));
        const scale = node.kind === "thought" ? Math.max(0.55, Math.min(1.15, 16 / d)) : 1;
        label.style.opacity = String(active ? 1 : fade * (node.kind === "thought" ? 0.5 + node.weight * 0.5 : 0.9));
        label.style.transform = `translate3d(${x + 12}px, ${y - 10}px, 0) scale(${scale})`;
        label.style.zIndex = String(Math.round(1000 - d * 10));
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      for (const e of world.entries.values()) {
        e.sprite.material.dispose();
        e.label?.remove();
      }
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
      core.material.dispose();
      world.floor.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      worldRef.current = null;
    };
    // The scene is built once; colour and speed updates are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- follow mood changes (a check-in re-renders with a new palette) ----
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.core.material.color.set(glow);
    (world.lines.material as THREE.LineBasicMaterial).color.set(ink);
    world.scene.remove(world.floor);
    world.floor.dispose();
    world.floor = makeFloor(ink);
    world.scene.add(world.floor);
    world.controls.autoRotateSpeed = 0.18 * speed;
  }, [glow, ink, speed]);

  // ---- keep the scene in sync with the data ----
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = new Map(nodes.map((n) => [n.id, n]));

    for (const [id, entry] of world.entries) {
      if (!next.has(id)) {
        world.scene.remove(entry.sprite);
        entry.sprite.material.dispose();
        entry.label?.remove();
        world.entries.delete(id);
      }
    }

    const now = performance.now();
    for (const node of nodes) {
      const existing = world.entries.get(node.id);
      const [x, y, z] = nodePosition(node);
      if (existing) {
        existing.node = node;
        existing.base.set(x, y, z);
        existing.sprite.material.color.set(node.color);
        if (existing.label) existing.label.textContent = node.label;
        continue;
      }
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: world.texture,
          color: new THREE.Color(node.color),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      sprite.scale.setScalar(world.synced ? 0.01 : nodeSize(node));
      sprite.position.set(x, y, z);
      world.scene.add(sprite);
      world.entries.set(node.id, {
        node,
        sprite,
        label: makeLabel(node, world.labels),
        base: new THREE.Vector3(x, y, z),
        phase: (x + y * 3 + z * 7) % (Math.PI * 2),
        spawnAt: world.synced ? now : 0,
      });
    }

    // Threads: each step hangs off its room; each thought is tethered to you.
    const pts: number[] = [];
    for (const { node, base } of world.entries.values()) {
      if (node.kind === "item" && node.room) {
        const room = world.entries.get(`room:${node.room}`);
        if (room) pts.push(base.x, base.y, base.z, room.base.x, room.base.y, room.base.z);
      } else if (node.kind === "thought" && node.weight > 0.6) {
        pts.push(0, 0, 0, base.x, base.y, base.z);
      }
    }
    world.lines.geometry.dispose();
    world.lines.geometry = new THREE.BufferGeometry();
    world.lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    world.synced = true;
  }, [nodes]);

  return (
    <div className="now" ref={hostRef}>
      <div className="now-labels" ref={labelsRef} aria-hidden />
    </div>
  );
}
