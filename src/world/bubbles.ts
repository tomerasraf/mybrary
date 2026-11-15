import * as THREE from "three";
import { fadedness } from "@/lib/aging";
import type { Thought } from "@/lib/thoughts";
import { Animator, damp, ease, lerp } from "./anim";
import { blobShadowTexture, createBubbleMaterial, textTexture } from "./bubbleMaterial";
import { INNER_SCALE, bubblePreview, bubbleRadius, hash01 } from "./layout";
import * as sound from "./sound";

type Phase = "forming" | "rising" | "floating" | "popping";

interface Bubble {
  id: number;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  label: THREE.Sprite;
  shadow: THREE.Mesh;
  radius: number;
  /** Where the library wants it (a loose spot, or a place inside its shelf). */
  target: THREE.Vector3;
  /** Inside a shelf: a little smaller, and it drifts less. */
  inner: boolean;
  phase: Phase;
  seed: number;
  glow: number;
  glowTarget: number;
  /** While carried (by the bird or by you), it follows this point instead of floating. */
  held: (() => THREE.Vector3) | null;
  /** A squish that decays: passing through a shelf wall, being grabbed. */
  squish: number;
  /** Drawn radius right now. */
  scale: number;
  source: Thought["source"];
  /** How faded with age it looks, 0..1. It brightens again while you look at it. */
  faded: number;
}

/** How much of an old bubble's shine is gone. */
const FADE = 0.55;
const LABEL_OPACITY = 0.85;

/** How quickly a floating bubble catches up with a new place. */
const GLIDE = 1.8;

const SPHERE = new THREE.IcosahedronGeometry(1, 5);
const FLOOR_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export class BubbleField {
  private bubbles = new Map<number, Bubble>();
  private hovered: number | null = null;
  private noticed = new Set<number>();
  /** Bubbles you asked to see: found by a search, or used in the bird's answer. */
  private marked = new Set<number>();
  private focused: number | null = null;

  constructor(
    private scene: THREE.Scene,
    private animator: Animator,
    private fontFamily: string,
  ) {}

  get count(): number {
    return this.bubbles.size;
  }

  /** Adds existing thoughts with no birth animation; call `snap` once their targets are set. */
  setAll(thoughts: Thought[]): void {
    for (const t of thoughts) this.create(t);
  }

  /** Jumps every floating bubble straight to its target (on load). */
  snap(): void {
    for (const b of this.bubbles.values()) {
      b.group.position.copy(b.target);
      b.scale = b.radius * (b.inner ? INNER_SCALE : 1);
    }
  }

  has(id: number): boolean {
    return this.bubbles.has(id);
  }

  ids(): number[] {
    return [...this.bubbles.keys()];
  }

  radiusOf(id: number): number {
    return this.bubbles.get(id)?.radius ?? 0;
  }

  /** Drawn radius right now (smaller inside a shelf). */
  sizeOf(id: number): number {
    return this.bubbles.get(id)?.scale ?? 0;
  }

  setTarget(id: number, p: THREE.Vector3, inner: boolean): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    b.target.copy(p);
    b.inner = inner;
  }

  /** Carry a bubble: it follows `at` every frame until released. Refuses one that's already carried. */
  hold(id: number, at: () => THREE.Vector3): boolean {
    const b = this.bubbles.get(id);
    if (!b || b.phase !== "floating" || b.held) return false;
    b.held = at;
    b.squish = Math.max(b.squish, 0.8);
    return true;
  }

  release(id: number): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    b.held = null;
    b.squish = Math.max(b.squish, 1);
  }

  isHeld(id: number): boolean {
    return !!this.bubbles.get(id)?.held;
  }

  jiggle(id: number, amount = 1): void {
    const b = this.bubbles.get(id);
    if (b) b.squish = Math.max(b.squish, amount);
  }

  /** A new bubble the bird blows out of its beak: it grows while held at `at`. */
  async blowAt(thought: Thought, at: () => THREE.Vector3, seconds = 1.6): Promise<void> {
    const b = this.create(thought);
    b.phase = "forming";
    b.held = at;
    b.group.position.copy(at());
    b.scale = 0.001;
    b.group.scale.setScalar(0.001);
    sound.swell(seconds);
    await this.animator.tween(
      seconds,
      (k) => {
        b.scale = Math.max(0.001, k * b.radius * INNER_SCALE);
        b.group.scale.setScalar(b.scale);
      },
      ease.out,
    );
    sound.pop(b.radius * 0.7);
    b.phase = "floating";
  }

  /** Blows a new bubble out of the tube mouth and lets it float up to its home. */
  async spawn(thought: Thought, mouth: THREE.Vector3): Promise<void> {
    const b = this.create(thought);
    b.phase = "forming";
    b.scale = 0.001;
    b.group.scale.setScalar(0.001);
    b.group.position.copy(mouth);
    b.material.uniforms.uWobble.value = 3;
    sound.swell(1.6);

    await this.animator.tween(
      1.7,
      (k) => {
        const s = Math.max(0.001, k) * b.radius;
        b.scale = s;
        b.group.scale.setScalar(s);
        b.group.position.set(mouth.x, mouth.y + s * 0.92, mouth.z);
      },
      ease.out,
    );

    // Let go.
    sound.pop(b.radius * 0.8);
    b.phase = "rising";
    const start = b.group.position.clone();
    const home = b.target.clone();
    const mid = new THREE.Vector3(lerp(start.x, home.x, 0.25), home.y + 1.2, lerp(start.z, home.z, 0.25));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, home);
    await this.animator.tween(
      3.6,
      (k) => {
        curve.getPoint(k, b.group.position);
        b.material.uniforms.uWobble.value = lerp(2.4, 1, k);
        const squish = 1 + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k);
        b.group.scale.set(b.radius / squish, b.radius * squish, b.radius / squish);
      },
      ease.inOut,
    );
    b.group.scale.setScalar(b.radius);
    b.scale = b.radius;
    b.phase = "floating";
  }

  /** Pops a bubble with a little spray of droplets and removes it. */
  async pop(id: number): Promise<void> {
    const b = this.bubbles.get(id);
    if (!b || b.phase === "popping") return;
    b.phase = "popping";
    sound.pop(b.radius);
    const drops = this.spray(b);
    const base = b.scale;
    await this.animator.tween(
      0.35,
      (k) => {
        b.group.scale.setScalar(base * (1 + k * 0.35));
        b.material.uniforms.uOpacity.value = 1 - k;
        (b.label.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - k);
        (b.shadow.material as THREE.MeshBasicMaterial).opacity *= 0.9;
      },
      ease.out,
    );
    this.dispose(b);
    await drops;
  }

  pick(raycaster: THREE.Raycaster): number | null {
    let best: { id: number; d: number } | null = null;
    for (const b of this.bubbles.values()) {
      if (b.phase !== "floating" || b.held) continue;
      const hit = raycaster.intersectObject(b.mesh, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id: b.id, d: hit.distance };
    }
    return best?.id ?? null;
  }

  setHover(id: number | null): void {
    this.hovered = id;
  }

  setFocus(id: number | null): void {
    this.focused = id;
  }

  /** Bubbles the bird is pointing out right now (they glow softly). */
  setNoticed(ids: readonly number[]): void {
    this.noticed = new Set(ids);
  }

  /** Bubbles you asked to see (they glow until this is called again). */
  setMarked(ids: readonly number[]): void {
    this.marked = new Set(ids);
  }

  isFloating(id: number): boolean {
    const b = this.bubbles.get(id);
    return b?.phase === "floating" && !b.held;
  }

  position(id: number): THREE.Vector3 | null {
    return this.bubbles.get(id)?.group.position ?? null;
  }

  /** A floating bubble for the bird to go look at. */
  randomFloating(except: number | null = null): number | null {
    const ids = [...this.bubbles.values()]
      .filter((b) => b.phase === "floating" && !b.held && b.id !== except && b.source !== "bird")
      .map((b) => b.id);
    if (ids.length === 0) return except !== null && this.bubbles.has(except) ? except : null;
    return ids[Math.floor(Math.random() * ids.length)];
  }

  update(dt: number, time: number): void {
    for (const b of this.bubbles.values()) {
      const u = b.material.uniforms;
      u.uTime.value = time;
      const pointedAt = this.noticed.has(b.id) || this.marked.has(b.id);
      b.glowTarget = b.id === this.focused ? 1 : b.id === this.hovered ? 0.6 : pointedAt ? 0.75 : 0;
      b.glow = lerp(b.glow, b.glowTarget, 1 - Math.exp(-8 * dt));
      u.uGlow.value = b.glow;
      if (b.faded > 0 && b.phase === "floating") {
        const dim = 1 - FADE * b.faded * (1 - Math.min(1, b.glow / 0.6));
        u.uOpacity.value = dim;
        (b.label.material as THREE.SpriteMaterial).opacity = LABEL_OPACITY * dim;
      }

      b.squish = Math.max(0, b.squish - dt * 2.2);
      if (b.held) {
        b.group.position.copy(b.held());
      } else if (b.phase === "floating") {
        // Drift around the target, and glide there when it moves.
        const t = time * 0.35 + b.seed * 10;
        const amp = b.inner ? 0.45 : 1;
        const p = b.group.position;
        const tx = b.target.x + Math.sin(t * 0.7) * 0.18 * amp;
        const ty = b.target.y + Math.sin(t) * 0.22 * amp;
        const tz = b.target.z + Math.cos(t * 0.6) * 0.18 * amp;
        p.set(damp(p.x, tx, GLIDE, dt), damp(p.y, ty, GLIDE, dt), damp(p.z, tz, GLIDE, dt));
      }
      if (b.phase === "floating") {
        b.scale = damp(b.scale, b.radius * (b.inner ? INNER_SCALE : 1), 3, dt);
        const s = b.scale * (1 + b.glow * 0.06);
        const q = 1 + Math.sin(time * 14 + b.seed * 9) * 0.09 * b.squish;
        b.group.scale.set(s / q, s * q, s / q);
        u.uWobble.value = 1 + b.squish * 2.5;
      }

      const p = b.group.position;
      const height = Math.max(0, p.y);
      b.shadow.position.set(p.x, 0.004, p.z);
      const spread = b.group.scale.x * (1.6 + height * 0.12);
      b.shadow.scale.set(spread, 1, spread);
      if (b.phase !== "popping") {
        (b.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 / (1 + height * 0.35);
      }
    }
  }

  private create(thought: Thought): Bubble {
    const seed = hash01(thought.id);
    const radius = bubbleRadius(thought.body);
    const material = createBubbleMaterial(seed);
    const mesh = new THREE.Mesh(SPHERE, material);
    mesh.renderOrder = 2;

    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textTexture(bubblePreview(thought.body), this.fontFamily),
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    label.scale.setScalar(1.45);
    label.renderOrder = 1;

    const group = new THREE.Group();
    group.add(mesh, label);
    group.scale.setScalar(radius);

    const shadow = new THREE.Mesh(
      FLOOR_PLANE,
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.3 }),
    );

    const bubble: Bubble = {
      id: thought.id,
      group,
      mesh,
      material,
      label,
      shadow,
      radius,
      target: new THREE.Vector3(0, 3, 0),
      inner: false,
      phase: "floating",
      seed,
      glow: 0,
      glowTarget: 0,
      held: null,
      squish: 0,
      scale: radius,
      source: thought.source,
      faded: thought.source === "bird" ? 0 : fadedness(thought.createdAt),
    };
    this.scene.add(group, shadow);
    this.bubbles.set(thought.id, bubble);
    return bubble;
  }

  private async spray(b: Bubble): Promise<void> {
    const origin = b.group.position.clone();
    const size = b.scale;
    const mat = new THREE.MeshBasicMaterial({ color: 0xb8c6e8, transparent: true, opacity: 0.7, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.035, 8, 6);
    const drops = Array.from({ length: 14 }, (_, i) => {
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 14) * Math.PI * 2;
      const up = Math.random() * 0.8 - 0.2;
      const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
      m.position.copy(origin).addScaledVector(dir, size);
      this.scene.add(m);
      return { m, dir };
    });
    await this.animator.tween(
      0.7,
      (k) => {
        for (const d of drops) {
          d.m.position.copy(origin).addScaledVector(d.dir, size * (1 + k * 0.9));
          d.m.position.y -= k * k * 0.6;
        }
        mat.opacity = 0.7 * (1 - k);
      },
      ease.out,
    );
    for (const d of drops) this.scene.remove(d.m);
    geo.dispose();
    mat.dispose();
  }

  private dispose(b: Bubble): void {
    this.scene.remove(b.group, b.shadow);
    b.material.dispose();
    const lm = b.label.material as THREE.SpriteMaterial;
    lm.map?.dispose();
    lm.dispose();
    (b.shadow.material as THREE.Material).dispose();
    this.bubbles.delete(b.id);
    if (this.hovered === b.id) this.hovered = null;
    if (this.focused === b.id) this.focused = null;
  }

  disposeAll(): void {
    for (const b of [...this.bubbles.values()]) this.dispose(b);
  }
}
