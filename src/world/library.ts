import * as THREE from "three";
import type { Cluster, Library, Link } from "@/lib/library";
import type { PlacedBy, Thought } from "@/lib/thoughts";
import type { Animator } from "./anim";
import { BubbleField } from "./bubbles";
import { ClusterField } from "./clusters";
import { bubbleHome, bubbleRadius, clusterRadius, nookSpot, packMembers, pushOut, shelfSpots, type Spot } from "./layout";
import { LinkField, type Anchor } from "./links";

interface Member {
  clusterId: number | null;
  placedBy: PlacedBy | null;
  source: Thought["source"];
  radius: number;
}

/** When several bubbles leave together, each one starts this long after the one before. */
const SETTLE_STAGGER_S = 0.7;

/** How strongly linked bubbles follow one you drag. */
const TUG = 0.6;

/**
 * The bird's library as it floats in the world: which bubble sits on which shelf, where every
 * shelf and loose bubble lives, and the links between them.
 */
export class LibraryScene {
  readonly bubbles: BubbleField;
  readonly clusters: ClusterField;
  readonly links: LinkField;

  private members = new Map<number, Member>();
  private looseHomes = new Map<number, THREE.Vector3>();
  private offsets = new Map<number, THREE.Vector3>();
  private nookId: number | null = null;
  private dragged: { id: number; at: THREE.Vector3; shelf: number | null } | null = null;
  private tmp = new THREE.Vector3();
  private tug = new THREE.Vector3();

  constructor(scene: THREE.Scene, animator: Animator, fontFamily: string) {
    this.bubbles = new BubbleField(scene, animator, fontFamily);
    this.clusters = new ClusterField(scene, animator, fontFamily);
    this.links = new LinkField(scene, animator, fontFamily);
  }

  /** Puts the whole library in place at once (on load). */
  load(lib: Library): void {
    for (const t of lib.thoughts) this.register(t);
    for (const c of lib.clusters) this.addClusterView(c, 1);
    this.bubbles.setAll(lib.thoughts);
    for (const l of lib.links) this.links.add(l);
    this.reviewCount = lib.review;
    this.relayout(true);
  }

  // ---------- reading ----------

  /** Bubbles the bird filed before reading them properly, and wants to look at again. */
  reviewCount = 0;

  /** Your bubbles (not the bird's own thoughts). */
  get personCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.source !== "bird") n++;
    return n;
  }

  get nook(): number | null {
    return this.nookId;
  }

  /** Whether this thought has a bubble in the world. */
  holds(id: number): boolean {
    return this.members.has(id);
  }

  clusterOf(id: number): number | null {
    return this.members.get(id)?.clusterId ?? null;
  }

  placedBy(id: number): PlacedBy | null {
    return this.members.get(id)?.placedBy ?? null;
  }

  /** Bubbles the bird may sort: yours, loose, and not placed there by you. */
  sortableCount(): number {
    let n = 0;
    for (const [id, m] of this.members) {
      if (m.source !== "bird" && m.clusterId === null && m.placedBy === null && this.bubbles.isFloating(id)) n++;
    }
    return n;
  }

  /** How far out the library reaches from the centre, on the floor. */
  extent(): number {
    let far = 0;
    for (const c of this.clusters.all()) far = Math.max(far, Math.hypot(c.home.x, c.home.z) + c.radiusTarget);
    for (const h of this.looseHomes.values()) far = Math.max(far, Math.hypot(h.x, h.z) + 1);
    return far;
  }

  shelfCount(): number {
    return this.clusters.all().filter((c) => c.kind === "shelf").length;
  }

  /** The shelf a point is inside (never the nook), for dropping a bubble you're dragging. */
  shelfAt(p: THREE.Vector3): number | null {
    let best: { id: number; d: number } | null = null;
    for (const c of this.clusters.all()) {
      if (c.kind !== "shelf" || c.born < 1) continue;
      const d = c.pos.distanceTo(p);
      if (d <= c.radius + 0.15 && (!best || d < best.d)) best = { id: c.id, d };
    }
    return best?.id ?? null;
  }

  // ---------- changes ----------

  /** A new bubble of yours (loose). The caller then spawns it with `bubbles.spawn`. */
  addThought(t: Thought): void {
    this.register(t);
    this.relayout();
  }

  /** A new thought of the bird's: it lives in the nook. The caller then blows it with `bubbles.blowAt`. */
  addBirdThought(t: Thought): void {
    this.register({ ...t, clusterId: t.clusterId ?? this.nookId });
    this.relayout();
  }

  removeThought(id: number): void {
    this.members.delete(id);
    this.offsets.delete(id);
    for (const l of this.links.of(id)) void this.links.remove(l, false);
    this.pruneEmpty();
    this.relayout();
  }

  /**
   * The bird took these thoughts into its page: their bubbles drift up and away, one after another.
   * Returns where the first one left from (for the bird to look at), or null when none were floating here.
   */
  settle(ids: readonly number[]): THREE.Vector3 | null {
    let from: THREE.Vector3 | null = null;
    let n = 0;
    for (const id of ids) {
      if (!this.members.has(id) || this.bubbles.isHeld(id)) continue;
      from ??= this.bubbles.position(id)?.clone() ?? null;
      this.members.delete(id);
      this.offsets.delete(id);
      void this.bubbles.ascend(id, n * SETTLE_STAGGER_S);
      n += 1;
    }
    if (n > 0) this.relayout();
    return from;
  }

  /** Moves a bubble onto a shelf (or loose, with null). `by` null: nobody placed it (a rolled-back move). */
  move(id: number, clusterId: number | null, by: PlacedBy | null): void {
    const m = this.members.get(id);
    if (!m) return;
    this.members.set(id, { ...m, clusterId, placedBy: by });
    if (clusterId !== null) {
      this.clusters.jiggle(clusterId, 1.2);
      this.bubbles.jiggle(id, 1.2);
    }
    this.pruneEmpty();
    this.relayout();
  }

  /** A new shelf. `born` 0 leaves it invisible, for the bird to blow up with `clusters.blow`. */
  addCluster(c: Cluster, born = 1): void {
    this.addClusterView(c, born);
    this.relayout();
    // A new shelf appears where it belongs, rather than gliding in from somewhere.
    const v = this.clusters.get(c.id);
    if (v) {
      v.pos.copy(v.home);
      v.radius = v.radiusTarget;
    }
  }

  updateCluster(c: Cluster): void {
    this.clusters.rename(c.id, c.name);
    this.clusters.recolor(c.id, c.color);
  }

  addLink(l: Link, grown = true): void {
    this.links.add(l, grown);
  }

  /**
   * Brings the world in line with the library as saved, after anything that may have drifted
   * (a slow or interrupted tidy, a failed save). Bubbles being carried right now are left alone.
   */
  sync(lib: Library): void {
    this.reviewCount = lib.review;
    // Shelves: new ones appear, gone ones pop, names and colours follow.
    const shelves = new Map(lib.clusters.map((c) => [c.id, c]));
    for (const c of lib.clusters) {
      const v = this.clusters.get(c.id);
      if (!v) {
        this.addClusterView(c, 1);
        continue;
      }
      v.born = 1;
      if (v.name !== c.name) this.clusters.rename(c.id, c.name);
      if (v.color !== c.color) this.clusters.recolor(c.id, c.color);
    }
    for (const v of this.clusters.all()) if (!shelves.has(v.id) && v.kind === "shelf") void this.clusters.pop(v.id);

    // Bubbles: where each one sits, and who put it there.
    const saved = new Map(lib.thoughts.map((t) => [t.id, t]));
    for (const t of lib.thoughts) {
      if (this.bubbles.isHeld(t.id)) continue;
      const m = this.members.get(t.id);
      if (!m) {
        this.register(t);
        if (!this.bubbles.has(t.id)) {
          this.bubbles.setAll([t]);
          const home = t.clusterId !== null ? this.clusters.get(t.clusterId)?.pos : undefined;
          if (home) this.bubbles.position(t.id)?.copy(home);
        }
      } else if (m.clusterId !== t.clusterId || m.placedBy !== t.placedBy) {
        this.members.set(t.id, { ...m, clusterId: t.clusterId, placedBy: t.placedBy });
      }
    }
    for (const id of [...this.members.keys()]) {
      if (saved.has(id) || this.bubbles.isHeld(id)) continue;
      this.members.delete(id);
      this.offsets.delete(id);
      void this.bubbles.pop(id);
    }

    // Links.
    const links = new Set(lib.links.map((l) => l.id));
    for (const l of lib.links) if (!this.links.has(l.id)) this.links.add(l);
    for (const l of this.links.all()) if (!links.has(l.id)) void this.links.remove(l.id);
    this.relayout();
  }

  // ---------- dragging ----------

  /** Picks up a bubble. Refuses one that's already being carried (by the bird). */
  startDrag(id: number, at: THREE.Vector3): boolean {
    const grab = { id, at: at.clone(), shelf: this.clusterOf(id) };
    if (!this.bubbles.hold(id, () => grab.at)) return false;
    this.dragged = grab;
    return true;
  }

  /**
   * Follows the pointer. `at` is the pointer on the bubble's own drag plane; `ray` is the pointer's
   * line of sight. The target is whichever shelf is under the pointer on screen (shelves sit at
   * different depths, so "inside in 3D" would miss), and over one the bubble sinks to its depth.
   */
  dragTo(at: THREE.Vector3, ray: THREE.Ray, raycaster: THREE.Raycaster): void {
    const d = this.dragged;
    if (!d) return;
    const hit = this.clusters.pick(raycaster);
    const shelf = hit ? this.clusters.get(hit.id) : undefined;
    d.shelf = shelf && shelf.kind === "shelf" && shelf.born >= 1 ? shelf.id : this.shelfAt(at);
    const target = d.shelf !== null ? this.clusters.get(d.shelf) : undefined;
    if (target) ray.closestPointToPoint(target.pos, d.at);
    else d.at.copy(at);
    this.clusters.setHighlight(d.shelf);
  }

  /** Lets go of the bubble you were dragging. Returns where it was dropped. */
  endDrag(): { id: number; shelf: number | null } | null {
    const d = this.dragged;
    if (!d) return null;
    this.dragged = null;
    this.bubbles.release(d.id);
    this.clusters.setHighlight(null);
    return { id: d.id, shelf: d.shelf };
  }

  get draggingId(): number | null {
    return this.dragged?.id ?? null;
  }

  // ---------- frame ----------

  update(dt: number, time: number): void {
    this.clusters.update(dt, time);

    // How far the dragged bubble has been pulled from its place: linked bubbles follow part of the way.
    let pulled: Set<number> | null = null;
    if (this.dragged) {
      const rest = this.restPosition(this.dragged.id, this.tmp);
      if (rest) {
        this.tug.subVectors(this.dragged.at, rest).multiplyScalar(TUG);
        pulled = new Set(this.links.neighbours(this.dragged.id));
      }
    }

    for (const id of this.members.keys()) {
      const rest = this.restPosition(id, this.tmp);
      if (!rest) continue;
      if (pulled?.has(id)) rest.add(this.tug);
      this.bubbles.setTarget(id, rest, this.isInside(id));
    }
    this.bubbles.update(dt, time);
    this.links.update(dt, time, (id) => this.anchor(id));
  }

  disposeAll(): void {
    this.bubbles.disposeAll();
    this.clusters.disposeAll();
    this.links.disposeAll();
  }

  /** Where a bubble's link attaches: its centre and drawn size. */
  anchor(id: number): Anchor | null {
    const p = this.bubbles.position(id);
    if (!p || this.members.get(id)?.source === "bird") return null;
    return { p, r: this.bubbles.sizeOf(id) };
  }

  // ---------- layout ----------

  private register(t: Pick<Thought, "id" | "clusterId" | "placedBy" | "source" | "body">): void {
    this.members.set(t.id, {
      clusterId: t.clusterId,
      placedBy: t.placedBy,
      source: t.source,
      radius: bubbleRadius(t.body),
    });
  }

  private addClusterView(c: Cluster, born: number): void {
    if (c.kind === "nook") this.nookId = c.id;
    const start = new THREE.Vector3(0, 3, -6);
    this.clusters.add(c, start, clusterRadius([]), born);
  }

  private isInside(id: number): boolean {
    const c = this.members.get(id)?.clusterId;
    return c !== null && c !== undefined && this.clusters.has(c);
  }

  /** Where a bubble rests right now: its loose spot, or its place inside its (drifting) shelf. */
  private restPosition(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const m = this.members.get(id);
    if (!m) return null;
    const shelf = m.clusterId !== null ? this.clusters.get(m.clusterId) : undefined;
    if (shelf) {
      const off = this.offsets.get(id);
      const k = shelf.radiusTarget > 0 ? (shelf.radius / shelf.radiusTarget) * shelf.born : 1;
      out.copy(shelf.pos);
      return off ? out.addScaledVector(off, k) : out;
    }
    const home = this.looseHomes.get(id);
    return home ? out.copy(home) : null;
  }

  /** Works out every shelf's size and place, every member's spot inside it, and every loose bubble's home. */
  private relayout(snap = false): void {
    const byCluster = new Map<number, number[]>();
    const loose: number[] = [];
    for (const [id, m] of [...this.members].sort((a, b) => a[0] - b[0])) {
      if (m.clusterId !== null && this.clusters.has(m.clusterId)) {
        byCluster.set(m.clusterId, [...(byCluster.get(m.clusterId) ?? []), id]);
      } else loose.push(id);
    }
    const radiusOf = (cid: number) => clusterRadius((byCluster.get(cid) ?? []).map((id) => this.members.get(id)!.radius));

    let nook: Spot | null = null;
    if (this.nookId !== null && this.clusters.has(this.nookId)) {
      nook = nookSpot(radiusOf(this.nookId));
      this.clusters.setLayout(this.nookId, new THREE.Vector3(nook.x, nook.y, nook.z), nook.r);
    }
    const shelves = this.clusters
      .all()
      .filter((c) => c.kind === "shelf")
      .sort((a, b) => a.id - b.id)
      .map((c) => ({ id: c.id, radius: radiusOf(c.id) }));
    for (const [id, s] of shelfSpots(shelves, loose.length, nook)) {
      this.clusters.setLayout(id, new THREE.Vector3(s.x, s.y, s.z), s.r);
    }

    for (const [cid, ids] of byCluster) {
      const packed = packMembers(
        ids.map((id) => this.members.get(id)!.radius),
        radiusOf(cid),
      );
      ids.forEach((id, i) => this.offsets.set(id, new THREE.Vector3(packed[i].x, packed[i].y, packed[i].z)));
    }
    this.looseHomes.clear();
    loose.forEach((id, i) => {
      const h = pushOut(bubbleHome(i), nook ? [nook] : []);
      this.looseHomes.set(id, new THREE.Vector3(h.x, h.y, h.z));
    });

    if (snap) {
      for (const c of this.clusters.all()) {
        c.pos.copy(c.home);
        c.radius = c.radiusTarget;
      }
      for (const id of this.members.keys()) {
        const rest = this.restPosition(id, this.tmp);
        if (rest) this.bubbles.setTarget(id, rest, this.isInside(id));
      }
      this.bubbles.snap();
    }
  }

  /** Shelves with nothing on them pop (unless the bird is still blowing one up). */
  private pruneEmpty(): void {
    const used = new Set([...this.members.values()].map((m) => m.clusterId));
    for (const c of this.clusters.all()) {
      if (c.kind === "shelf" && c.born >= 1 && !used.has(c.id)) void this.clusters.pop(c.id);
    }
  }
}
