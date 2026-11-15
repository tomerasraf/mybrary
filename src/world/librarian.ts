import * as THREE from "three";
import { FILED, NEW_SHELF, WROTE, pick } from "@/lib/bird/lines";
import type { TidyStep } from "@/lib/library";
import type { Thought } from "@/lib/thoughts";
import type { Animator } from "./anim";
import type { Bird } from "./bird";
import type { LibraryScene } from "./library";
import type { Motor } from "./motor";
import * as sound from "./sound";

/** How far below a bubble the bird hovers to balance it on its head. */
const UNDER = 0.42;
/** How long the bird takes to scoop a bubble onto its head. */
const SCOOP_S = 0.4;

/**
 * The bird's work as a librarian, acted out in the world: blowing up new shelves, carrying bubbles
 * into them, drawing links between bubbles, and blowing its own thoughts into its nook.
 */
export class Librarian {
  private tmp = new THREE.Vector3();

  constructor(
    private bird: Bird,
    private motor: Motor,
    private lib: LibraryScene,
    private animator: Animator,
    private say: (text: string, seconds?: number) => void,
  ) {}

  /**
   * Acts out the steps of a tidy, one by one. If interrupted, whatever wasn't shown yet is put in
   * place at once, so the world always matches what was saved.
   */
  async perform(steps: readonly TidyStep[], signal: AbortSignal): Promise<void> {
    let done = 0;
    try {
      for (const step of steps) {
        if (step.kind === "shelf") await this.blowShelf(step, signal);
        else if (step.kind === "file") await this.file(step, signal);
        else await this.link(step, signal);
        done += 1;
        await this.animator.wait(0.35, signal);
      }
    } finally {
      this.snapAll(steps.slice(done));
    }
  }

  /** Puts tidy steps in place without acting them out. */
  snapAll(steps: readonly TidyStep[]): void {
    for (const step of steps) this.snap(step);
  }

  /** Puts one of the bird's thoughts straight into its nook, without the show. */
  place(thought: Thought): void {
    if (this.lib.bubbles.has(thought.id)) return;
    this.lib.addBirdThought(thought);
    this.lib.bubbles.setAll([thought]);
    const nook = this.lib.nook !== null ? this.lib.clusters.get(this.lib.nook) : undefined;
    if (nook) this.lib.bubbles.position(thought.id)?.copy(nook.pos);
  }

  /** Blows one of its own thoughts out of its beak, and tucks it into the nook. */
  async writeDown(thought: Thought, signal: AbortSignal): Promise<void> {
    const nookId = this.lib.nook;
    const nook = nookId !== null ? this.lib.clusters.get(nookId) : undefined;
    let shown = false;
    try {
      if (!nook) return;
      await this.motor.flyTo(this.beside(nook.pos, nook.radius + 0.5, 0.1), signal);
      await this.motor.faceToward(nook.pos, signal);
      this.bird.beakOpen = 1;
      const beak = () => {
        this.motor.headPoint(this.tmp);
        const fwd = new THREE.Vector3(Math.sin(this.bird.root.rotation.y), 0, Math.cos(this.bird.root.rotation.y));
        return this.tmp.addScaledVector(fwd, 0.35);
      };
      shown = true;
      this.lib.addBirdThought(thought);
      await this.lib.bubbles.blowAt(thought, beak, 1.8);
      this.bird.beakOpen = 0;
      this.lib.bubbles.release(thought.id);
      this.lib.clusters.jiggle(nook.id, 1.3);
      sound.squish(0.8);
      this.say(pick(WROTE), 4.5);
      await this.animator.wait(2.5, signal);
    } finally {
      this.bird.beakOpen = 0;
      // Interrupted before it was blown: it simply appears in the nook.
      if (!shown) this.place(thought);
      this.lib.bubbles.release(thought.id);
    }
  }

  // ---------- steps ----------

  private async blowShelf(step: Extract<TidyStep, { kind: "shelf" }>, signal: AbortSignal): Promise<void> {
    this.lib.addCluster(step.cluster, 0);
    const view = this.lib.clusters.get(step.cluster.id);
    if (!view) return;
    await this.motor.flyTo(this.beside(view.home, view.radiusTarget + 0.45, -0.1), signal);
    await this.motor.faceToward(view.home, signal);
    this.bird.beakOpen = 1;
    try {
      await this.lib.clusters.blow(step.cluster.id, 2.2, signal);
    } finally {
      this.bird.beakOpen = 0;
    }
    this.bird.flap = 1;
    this.say(Math.random() < 0.5 ? `a shelf for "${step.cluster.name}"` : pick(NEW_SHELF), 3);
    await this.animator.wait(0.8, signal);
    this.bird.flap = 0.4;
  }

  private async file(step: Extract<TidyStep, { kind: "file" }>, signal: AbortSignal): Promise<void> {
    const { thoughtId: id, clusterId } = step;
    // You may have moved it yourself meanwhile: then it stays where you put it.
    if (!this.lib.bubbles.isFloating(id) || this.lib.placedBy(id) === "you" || this.lib.clusterOf(id) !== step.from) return;
    const at = this.lib.bubbles.position(id);
    // No shelf: the bird takes the bubble down, and it floats free again.
    const shelf = clusterId === null ? null : this.lib.clusters.get(clusterId);
    if (!at || shelf === undefined) return;

    // Fly up under the bubble and scoop it onto its head.
    const size = this.lib.bubbles.sizeOf(id);
    await this.motor.flyTo(this.tmp.copy(at).setY(Math.max(0.6, at.y - size - UNDER)).clone(), signal);
    this.bird.lookUp = 1;
    const from = at.clone();
    let k = 0;
    const balanced = new THREE.Vector3();
    const grabbed = this.lib.bubbles.hold(id, () => {
      this.motor.headPoint(balanced).y += size * 0.95;
      return balanced.lerpVectors(from, balanced, k);
    });
    // You grabbed it first: it's yours, the bird leaves it be.
    if (!grabbed) return;
    sound.touch();
    try {
      await this.animator.tween(SCOOP_S, (x) => (k = x), undefined, signal);

      if (shelf) {
        // Carry it to the shelf's wall, on the side facing the bird.
        const wall = this.beside(shelf.pos, shelf.radius + size + 0.15, -(size + UNDER));
        await this.motor.flyTo(wall, signal, 1.5);
        await this.motor.faceToward(shelf.pos, signal);
        this.bird.lean = 1;
      }
      await this.animator.wait(0.25, signal);
    } finally {
      // Let go: it squishes through the wall and settles in its place.
      this.bird.lean = 0;
      this.bird.lookUp = 0;
      this.lib.bubbles.release(id);
      if (this.lib.placedBy(id) !== "you") this.lib.move(id, clusterId, clusterId === null ? null : "bird");
    }
    sound.squish(size);
    if (Math.random() < 0.35) this.say(pick(FILED), 2);
    await this.animator.wait(0.4, signal);
  }

  private async link(step: Extract<TidyStep, { kind: "link" }>, signal: AbortSignal): Promise<void> {
    const { link } = step;
    const a = this.lib.bubbles.position(link.a);
    const b = this.lib.bubbles.position(link.b);
    if (!a || !b) return;
    const sizeA = this.lib.bubbles.sizeOf(link.a);
    await this.motor.flyTo(this.tmp.copy(a).setY(Math.max(0.6, a.y - sizeA - UNDER)).clone(), signal);
    this.bird.lookUp = 1;
    this.lib.addLink(link, false);
    const end = new THREE.Vector3();
    this.lib.links.startDrawing(link.id, () => this.motor.headPoint(end));
    sound.swell(1.2);
    try {
      const sizeB = this.lib.bubbles.sizeOf(link.b);
      const bNow = this.lib.bubbles.position(link.b) ?? b;
      await this.motor.flyTo(bNow.clone().setY(Math.max(0.6, bNow.y - sizeB - UNDER)), signal, 1.4);
    } finally {
      this.bird.lookUp = 0;
      await this.lib.links.finish(link.id);
    }
    this.say(`"${link.word}"`, 3);
    await this.animator.wait(1.2, signal);
  }

  /** Puts a step's result in place without acting it out. */
  private snap(step: TidyStep): void {
    if (step.kind === "shelf") {
      if (!this.lib.clusters.has(step.cluster.id)) this.lib.addCluster(step.cluster, 1);
      const v = this.lib.clusters.get(step.cluster.id);
      if (v) v.born = 1;
    } else if (step.kind === "file") {
      if (this.lib.draggingId === step.thoughtId) return;
      this.lib.bubbles.release(step.thoughtId);
      if (this.lib.placedBy(step.thoughtId) !== "you" && this.lib.clusterOf(step.thoughtId) === step.from) {
        this.lib.move(step.thoughtId, step.clusterId, step.clusterId === null ? null : "bird");
      }
    } else if (!this.lib.links.has(step.link.id)) {
      this.lib.addLink(step.link, true);
    }
  }

  /** A point next to something big, on the side toward the bird, raised or lowered by `dy`. */
  private beside(center: THREE.Vector3, distance: number, dy: number): THREE.Vector3 {
    const me = this.motor.position;
    const dir = new THREE.Vector3(me.x - center.x, 0, me.z - center.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const p = center.clone().addScaledVector(dir, distance);
    p.y = Math.max(0.6, center.y + dy);
    return p;
  }
}
