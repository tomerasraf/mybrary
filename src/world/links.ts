import * as THREE from "three";
import type { Link } from "@/lib/library";
import { Animator, damp, ease } from "./anim";
import { createBubbleMaterial, labelTexture } from "./bubbleMaterial";
import { hash01 } from "./layout";
import * as sound from "./sound";

/**
 * A link between two bubbles, drawn as soap film: a neck grows out of each bubble and they meet
 * in a little bubble (the knot) that holds the word for why they belong together.
 */
interface LinkView {
  id: number;
  a: number;
  b: number;
  word: string;
  necks: [THREE.Mesh, THREE.Mesh];
  knot: THREE.Mesh;
  material: THREE.ShaderMaterial;
  label: THREE.Sprite;
  labelAspect: number;
  knotR: number;
  /** 0..1: how much of the link has been drawn. */
  grow: number;
  /** While the bird is drawing it, the far end follows this point. */
  drawEnd: (() => THREE.Vector3) | null;
  glow: number;
  seed: number;
}

export interface Anchor {
  p: THREE.Vector3;
  /** Drawn radius of the bubble. */
  r: number;
}

// A neck along +Y: wide where it leaves the bubble (y = 0), thin where it meets the knot (y = 1).
const NECK = (() => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = i / 24;
    pts.push(new THREE.Vector2(0.05 + 0.12 * (1 - y) ** 3 + 0.02 * y ** 6, y));
  }
  return new THREE.LatheGeometry(pts, 20);
})();
const KNOT = new THREE.IcosahedronGeometry(1, 4);
const UP = new THREE.Vector3(0, 1, 0);
const LABEL_H = 0.2;

export class LinkField {
  private views = new Map<number, LinkView>();
  private hovered: number | null = null;
  private tmp = {
    dir: new THREE.Vector3(),
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    mid: new THREE.Vector3(),
    knotA: new THREE.Vector3(),
    knotB: new THREE.Vector3(),
  };

  constructor(
    private scene: THREE.Scene,
    private animator: Animator,
    private fontFamily: string,
  ) {}

  all(): { id: number; a: number; b: number }[] {
    return [...this.views.values()].map((v) => ({ id: v.id, a: v.a, b: v.b }));
  }

  has(id: number): boolean {
    return this.views.has(id);
  }

  /** Links touching this bubble. */
  of(bubble: number): number[] {
    return [...this.views.values()].filter((v) => v.a === bubble || v.b === bubble).map((v) => v.id);
  }

  /** The other end of every link touching this bubble. */
  neighbours(bubble: number): number[] {
    return [...this.views.values()].flatMap((v) => (v.a === bubble ? [v.b] : v.b === bubble ? [v.a] : []));
  }

  add(link: Link, grown = true): void {
    if (this.views.has(link.id)) return;
    const seed = hash01(link.id + 5000);
    const material = createBubbleMaterial(seed);
    material.uniforms.uTintAmt.value = 0.06;
    const necks = [new THREE.Mesh(NECK, material), new THREE.Mesh(NECK, material)] as [THREE.Mesh, THREE.Mesh];
    const knot = new THREE.Mesh(KNOT, material);
    for (const m of [...necks, knot]) m.renderOrder = 3;
    const { texture, aspect } = labelTexture(link.word, this.fontFamily);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    label.renderOrder = 6;
    const knotR = Math.max(0.17, Math.min(0.42, LABEL_H * aspect * 0.55));
    const view: LinkView = {
      id: link.id,
      a: link.a,
      b: link.b,
      word: link.word,
      necks,
      knot,
      material,
      label,
      labelAspect: aspect,
      knotR,
      grow: grown ? 1 : 0,
      drawEnd: null,
      glow: 0,
      seed,
    };
    this.scene.add(...necks, knot, label);
    this.views.set(link.id, view);
  }

  /** The bird draws the link out: the far end follows `end`, until `finish` is called. */
  startDrawing(id: number, end: () => THREE.Vector3): void {
    const v = this.views.get(id);
    if (!v) return;
    v.grow = 0;
    v.drawEnd = end;
  }

  /** The link snaps onto its second bubble and the word appears. */
  async finish(id: number, signal?: AbortSignal): Promise<void> {
    const v = this.views.get(id);
    if (!v) return;
    v.drawEnd = null;
    sound.pop(0.5);
    try {
      await this.animator.tween(0.6, (k) => (v.grow = k), ease.back, signal);
    } finally {
      v.grow = 1;
    }
  }

  async remove(id: number, animate = true): Promise<void> {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    if (animate) {
      sound.pop(0.4);
      const g = v.grow;
      await this.animator.tween(0.3, (k) => {
        v.material.uniforms.uOpacity.value = 1 - k;
        (v.label.material as THREE.SpriteMaterial).opacity = 1 - k;
        v.knot.scale.setScalar(v.knotR * g * (1 + k * 0.5));
      });
    }
    this.dispose(v);
  }

  setHover(id: number | null): void {
    this.hovered = id;
  }

  pick(raycaster: THREE.Raycaster): number | null {
    let best: { id: number; d: number } | null = null;
    for (const v of this.views.values()) {
      if (v.grow < 0.9) continue;
      const hit = raycaster.intersectObject(v.knot, false)[0] ?? raycaster.intersectObject(v.label, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id: v.id, d: hit.distance };
    }
    return best?.id ?? null;
  }

  update(dt: number, time: number, anchor: (bubble: number) => Anchor | null): void {
    const { dir, start, end, mid, knotA, knotB } = this.tmp;
    for (const v of this.views.values()) {
      const A = anchor(v.a);
      const B = v.drawEnd ? { p: v.drawEnd(), r: 0 } : anchor(v.b);
      const visible = !!A && !!B;
      for (const m of [...v.necks, v.knot, v.label]) m.visible = visible;
      if (!A || !B) continue;

      dir.subVectors(B.p, A.p);
      const len = dir.length();
      if (len < 1e-4) continue;
      dir.divideScalar(len);
      start.copy(A.p).addScaledVector(dir, A.r * 0.9);
      end.copy(B.p).addScaledVector(dir, -B.r * 0.9);
      const span = Math.max(0.01, start.distanceTo(end));
      // The knot hangs a touch below the middle, like something soft.
      mid.lerpVectors(start, end, 0.5);
      mid.y -= Math.min(0.35, span * 0.05) - Math.sin(time * 1.3 + v.seed * 8) * 0.03;

      const kr = v.knotR * (v.drawEnd ? 0.5 : Math.max(0.5, v.grow));
      knotA.subVectors(mid, start);
      knotB.subVectors(mid, end);
      this.placeNeck(v.necks[0], start, knotA, kr);
      this.placeNeck(v.necks[1], end, knotB, kr);
      v.knot.position.copy(mid);
      const breathe = 1 + Math.sin(time * 2 + v.seed * 5) * 0.03;
      v.knot.scale.set(kr * 1.15 * breathe, kr * breathe, kr * 1.15 * breathe);

      const lm = v.label.material as THREE.SpriteMaterial;
      lm.opacity = v.drawEnd ? 0 : Math.min(1, v.grow) * 0.95;
      v.label.position.copy(mid);
      const lh = LABEL_H * Math.min(1, v.grow);
      v.label.scale.set(Math.max(0.001, lh * v.labelAspect), Math.max(0.001, lh), 1);

      v.glow = damp(v.glow, v.id === this.hovered ? 1 : 0, 8, dt);
      v.material.uniforms.uTime.value = time;
      v.material.uniforms.uGlow.value = v.glow * 0.7;
      v.material.uniforms.uWobble.value = v.drawEnd ? 2 : 1;
    }
  }

  disposeAll(): void {
    for (const v of [...this.views.values()]) this.dispose(v);
    this.views.clear();
  }

  /** Stretches a neck from `from` along `span` (stopping at the knot's skin). */
  private placeNeck(m: THREE.Mesh, from: THREE.Vector3, span: THREE.Vector3, knotR: number): void {
    const len = Math.max(0.001, span.length() - knotR * 0.7);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(UP, span.clone().normalize());
    m.scale.set(1, len, 1);
  }

  private dispose(v: LinkView): void {
    this.scene.remove(...v.necks, v.knot, v.label);
    v.material.dispose();
    const lm = v.label.material as THREE.SpriteMaterial;
    lm.map?.dispose();
    lm.dispose();
    if (this.hovered === v.id) this.hovered = null;
  }
}
