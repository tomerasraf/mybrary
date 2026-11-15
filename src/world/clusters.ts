import * as THREE from "three";
import { SHELF_COLORS, type ShelfColor } from "@/lib/colors";
import type { Cluster, ClusterKind } from "@/lib/library";
import { Animator, damp, ease } from "./anim";
import { blobShadowTexture, createBubbleMaterial, labelTexture } from "./bubbleMaterial";
import { hash01 } from "./layout";
import * as sound from "./sound";

/** A shelf (or the bird's nook) as drawn: one big soap bubble with its name floating above. */
export interface ClusterView {
  id: number;
  kind: ClusterKind;
  name: string;
  color: ShelfColor;
  group: THREE.Group;
  shell: THREE.Mesh;
  material: THREE.ShaderMaterial;
  label: THREE.Sprite;
  labelAspect: number;
  shadow: THREE.Mesh;
  /** Where it lives, and how big it should be (set by the layout). */
  home: THREE.Vector3;
  radiusTarget: number;
  /** Drawn now (they glide toward home and radiusTarget). */
  pos: THREE.Vector3;
  radius: number;
  /** 0..1 while being blown up by the bird. */
  born: number;
  seed: number;
  glow: number;
  /** A jiggle when something passes through the wall; decays on its own. */
  wobble: number;
}

const SPHERE = new THREE.IcosahedronGeometry(1, 6);
const FLOOR_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const NOOK_INK = "rgba(150, 104, 20, 0.92)";
const LABEL_HEIGHT = 0.36;

export class ClusterField {
  private views = new Map<number, ClusterView>();
  private hovered: number | null = null;
  private highlighted: number | null = null;

  constructor(
    private scene: THREE.Scene,
    private animator: Animator,
    private fontFamily: string,
  ) {}

  get(id: number): ClusterView | undefined {
    return this.views.get(id);
  }

  all(): ClusterView[] {
    return [...this.views.values()];
  }

  has(id: number): boolean {
    return this.views.has(id);
  }

  /** Adds a shelf. `born` 0 means it starts invisible, for the bird to blow up. */
  add(cluster: Cluster, home: THREE.Vector3, radius: number, born = 1): ClusterView {
    const existing = this.views.get(cluster.id);
    if (existing) return existing;
    const seed = hash01(cluster.id + 1000);
    const material = createBubbleMaterial(seed);
    const shell = new THREE.Mesh(SPHERE, material);
    shell.renderOrder = 4;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0.95 }));
    label.renderOrder = 5;
    const group = new THREE.Group();
    group.add(shell);
    const shadow = new THREE.Mesh(
      FLOOR_PLANE,
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.2 }),
    );
    const view: ClusterView = {
      id: cluster.id,
      kind: cluster.kind,
      name: "",
      color: cluster.color,
      group,
      shell,
      material,
      label,
      labelAspect: 1,
      shadow,
      home: home.clone(),
      radiusTarget: radius,
      pos: home.clone(),
      radius,
      born,
      seed,
      glow: 0,
      wobble: 0,
    };
    this.setName(view, cluster.name);
    this.paint(view, cluster.color);
    this.scene.add(group, label, shadow);
    this.views.set(cluster.id, view);
    return view;
  }

  rename(id: number, name: string): void {
    const v = this.views.get(id);
    if (v && v.name !== name) this.setName(v, name);
  }

  recolor(id: number, color: ShelfColor): void {
    const v = this.views.get(id);
    if (!v) return;
    this.paint(v, color);
    v.wobble = Math.max(v.wobble, 0.8);
    sound.touch();
  }

  setLayout(id: number, home: THREE.Vector3, radius: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.home.copy(home);
    v.radiusTarget = radius;
  }

  /** Something just squished through the wall. */
  jiggle(id: number, amount = 1): void {
    const v = this.views.get(id);
    if (v) v.wobble = Math.max(v.wobble, amount);
  }

  setHover(id: number | null): void {
    this.hovered = id;
  }

  /** The shelf a bubble you're dragging would drop into. */
  setHighlight(id: number | null): void {
    this.highlighted = id;
  }

  /** Grows the shelf from nothing, like the bird blowing it up. */
  async blow(id: number, seconds = 2.2, signal?: AbortSignal): Promise<void> {
    const v = this.views.get(id);
    if (!v) return;
    sound.swell(seconds * 0.9);
    try {
      await this.animator.tween(seconds, (k) => (v.born = k), ease.out, signal);
    } finally {
      v.born = 1;
      v.wobble = 1.4;
    }
    sound.pop(v.radius * 0.6);
  }

  /** Pops an empty shelf away. */
  async pop(id: number): Promise<void> {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    sound.pop(v.radius * 0.7);
    const from = v.born;
    await this.animator.tween(0.4, (k) => {
      v.group.scale.setScalar(v.radius * from * (1 + k * 0.3));
      v.material.uniforms.uOpacity.value = 1 - k;
      (v.label.material as THREE.SpriteMaterial).opacity = 1 - k;
    });
    this.dispose(v);
  }

  /** Is this point inside the shelf? (For dropping a dragged bubble.) */
  contains(id: number, p: THREE.Vector3, slack = 0): boolean {
    const v = this.views.get(id);
    return !!v && v.born > 0.5 && v.pos.distanceTo(p) <= v.radius + slack;
  }

  pick(raycaster: THREE.Raycaster): { id: number; distance: number } | null {
    let best: { id: number; distance: number } | null = null;
    for (const v of this.views.values()) {
      if (v.born < 0.5) continue;
      const hit = raycaster.intersectObject(v.shell, false)[0] ?? raycaster.intersectObject(v.label, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { id: v.id, distance: hit.distance };
    }
    return best;
  }

  update(dt: number, time: number): void {
    for (const v of this.views.values()) {
      // Glide toward the layout, with a slow, heavy drift.
      const t = time * 0.18 + v.seed * 20;
      const tx = v.home.x + Math.sin(t * 0.8) * 0.12;
      const ty = v.home.y + Math.sin(t) * 0.16;
      const tz = v.home.z + Math.cos(t * 0.7) * 0.12;
      v.pos.set(damp(v.pos.x, tx, 1.6, dt), damp(v.pos.y, ty, 1.6, dt), damp(v.pos.z, tz, 1.6, dt));
      v.radius = damp(v.radius, v.radiusTarget, 2.2, dt);

      const target = v.id === this.highlighted ? 1 : v.id === this.hovered ? 0.45 : 0;
      v.glow = damp(v.glow, target, 8, dt);
      v.wobble = Math.max(0, v.wobble - dt * 0.9);

      const u = v.material.uniforms;
      u.uTime.value = time;
      u.uGlow.value = v.glow * 0.6;
      u.uWobble.value = 0.6 + v.wobble * 3.2;
      const squash = 1 + Math.sin(time * 9) * 0.025 * v.wobble;
      const s = v.radius * Math.max(0.001, v.born) * (1 + v.glow * 0.03);
      v.group.position.copy(v.pos);
      v.group.scale.set(s / squash, s * squash, s / squash);

      // The name floats just above the top.
      const lm = v.label.material as THREE.SpriteMaterial;
      lm.opacity = 0.95 * Math.max(0, (v.born - 0.6) / 0.4);
      v.label.position.set(v.pos.x, v.pos.y + s + LABEL_HEIGHT * 0.9, v.pos.z);
      v.label.scale.set(LABEL_HEIGHT * v.labelAspect, LABEL_HEIGHT, 1);

      const height = Math.max(0, v.pos.y);
      const spread = s * (1.7 + height * 0.1);
      v.shadow.position.set(v.pos.x, 0.003, v.pos.z);
      v.shadow.scale.set(spread, 1, spread);
      (v.shadow.material as THREE.MeshBasicMaterial).opacity = (0.32 / (1 + height * 0.3)) * v.born;
    }
  }

  disposeAll(): void {
    for (const v of [...this.views.values()]) this.dispose(v);
    this.views.clear();
  }

  private setName(v: ClusterView, name: string): void {
    v.name = name;
    const lm = v.label.material as THREE.SpriteMaterial;
    lm.map?.dispose();
    const { texture, aspect } = labelTexture(name, this.fontFamily, v.kind === "nook" ? NOOK_INK : undefined);
    lm.map = texture;
    lm.needsUpdate = true;
    v.labelAspect = aspect;
  }

  private paint(v: ClusterView, color: ShelfColor): void {
    v.color = color;
    const u = v.material.uniforms;
    // The shader writes raw sRGB, so hand it the colour as written rather than linearised.
    (u.uTint.value as THREE.Color).set(SHELF_COLORS[color]).convertLinearToSRGB();
    u.uTintAmt.value = color === "pearl" ? 0.15 : v.kind === "nook" ? 0.7 : 0.75;
  }

  private dispose(v: ClusterView): void {
    this.scene.remove(v.group, v.label, v.shadow);
    v.material.dispose();
    const lm = v.label.material as THREE.SpriteMaterial;
    lm.map?.dispose();
    lm.dispose();
    (v.shadow.material as THREE.Material).dispose();
    this.views.delete(v.id);
    if (this.hovered === v.id) this.hovered = null;
    if (this.highlighted === v.id) this.highlighted = null;
  }
}
