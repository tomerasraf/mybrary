import * as THREE from "three";
import type { Thought } from "@/lib/thoughts";
import { JOY, LISTENING, POKED, QUIET, SETTLED, pick } from "@/lib/bird/lines";
import { Animator, Cancelled } from "./anim";
import type { Bird } from "./bird";
import type { Desk } from "./desk";
import { clampToRing } from "./layout";
import type { LibraryScene } from "./library";
import { Motor } from "./motor";
import * as sound from "./sound";
import type { ThoughtMachine, Tube } from "./tube";

export interface BrainHooks {
  say: (text: string, seconds: number) => void;
  /**
   * A thought was just born: ask the bird's brain (the local model, or Claude) for its one question
   * about it. Resolves null when it has nothing worth asking, or can't think right now.
   */
  think: (thoughtId: number) => Promise<string | null>;
}

const REST_SPOT = new THREE.Vector3(3.6, 0, 2.3);
/** How long the bird waits for its brain, after the bubble is born, before letting it be. */
const THINK_PATIENCE_S = 35;
/** How long its question stays up. You can still answer it from the composer after that. */
const QUESTION_S = 14;
/** The bird is quiet by default. Now and then it makes a small sound to itself. */
const MURMUR_CHANCE = 0.12;
const REMEMBER_VISITS = 4;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Decides what the bird is doing, one behaviour at a time. */
export class Brain {
  private composing = false;
  private delivering = false;
  private queue: Thought[] = [];
  private ctl = new AbortController();
  private disposed = false;
  private visited: number[] = [];
  /** Where bubbles just left from: the bird turns to watch them go. */
  private leaving: THREE.Vector3[] = [];
  private motor: Motor;

  constructor(
    private bird: Bird,
    private desk: Desk,
    private machine: ThoughtMachine,
    private tube: Tube,
    private lib: LibraryScene,
    private animator: Animator,
    private hooks: BrainHooks,
  ) {
    bird.root.position.copy(REST_SPOT);
    bird.root.rotation.y = -0.6;
    bird.onStep = sound.step;
    this.motor = new Motor(bird, animator);
  }

  private get bubbles() {
    return this.lib.bubbles;
  }

  start(greeting: string): void {
    void this.run(greeting);
  }

  dispose(): void {
    this.disposed = true;
    this.ctl.abort();
  }

  /** The person started (or stopped) writing or talking. */
  setComposing(value: boolean): void {
    if (this.composing === value) return;
    this.composing = value;
    this.interrupt();
  }

  /** Text arrived: the bird types, if it is at its desk. */
  keystroke(textLength: number): void {
    const newLine = this.desk.type(textLength);
    if (!this.bird.typing) return;
    // Roughly every fifth key is the space bar: a lower, rounder sound.
    const space = Math.random() < 0.2;
    this.bird.strike();
    this.desk.strike(space);
    sound.clack(space);
    if (newLine) sound.carriageReturn();
  }

  /** Whether something is going on that deserves smooth motion: you're writing, or the bird is at its ritual. */
  get lively(): boolean {
    return this.composing || this.delivering || this.queue.length > 0;
  }

  /** A thought was saved; the bird will carry it to the tube. Resolves when the bubble is born. */
  deliver(thought: Thought): void {
    this.queue.push(thought);
    this.interrupt();
  }

  /** You tapped the bird. */
  poke(): void {
    sound.chirp();
    this.say(pick(POKED));
    void this.motor.hop(1, 0.1).catch(() => {});
  }

  /** Bubbles the bird took into the page are floating away from here: it watches them go. */
  seeOff(from: THREE.Vector3): void {
    this.leaving.push(from.clone());
    // Not while you're talking or it's carrying a page: it gets to it right after.
    if (!this.composing && !this.delivering) this.interrupt();
  }

  // ---------- main loop ----------

  private interrupt(): void {
    this.ctl.abort();
  }

  private async run(greeting: string): Promise<void> {
    await this.animator.wait(1.2).catch(() => {});
    this.say(greeting, 5);
    sound.chirp(true);
    await this.animator.wait(3).catch(() => {});

    while (!this.disposed) {
      this.ctl = new AbortController();
      const signal = this.ctl.signal;
      this.reset();
      try {
        await this.motor.land();
        const next = this.queue.shift();
        if (next) {
          this.delivering = true;
          try {
            await this.deliverNow(next);
          } finally {
            this.delivering = false;
          }
        }
        else if (this.composing) await this.atDesk(signal);
        else if (this.leaving.length > 0) await this.watchGo(signal);
        else await this.idle(signal);
      } catch (error) {
        if (!(error instanceof Cancelled)) console.error("[bird] behaviour failed", error);
      }
    }
  }

  private reset(): void {
    const b = this.bird;
    b.moving = 0;
    b.typing = false;
    b.lookUp = 0;
    b.lean = 0;
    b.slump = 0;
    b.flap = this.motor.airborne ? 0.4 : 0;
    b.beakOpen = 0;
    b.hopY = 0;
  }

  // ---------- behaviours ----------

  private async atDesk(signal: AbortSignal): Promise<void> {
    await this.motor.walkTo(this.desk.standAt, signal, 1.7);
    await this.motor.face(this.desk.facing, signal);
    this.bird.typing = true;
    if (Math.random() < 0.35) this.say(pick(LISTENING), 2.5);
    await this.until(signal);
  }

  /** Nothing to do, and that's fine: the bird potters about quietly. It doesn't comment on your thoughts. */
  private async idle(signal: AbortSignal): Promise<void> {
    const a = this.animator;
    const roll = Math.random();
    const id = roll < 0.4 ? this.bubbles.randomFloating(this.visited.at(-1) ?? null) : null;
    if (id !== null) {
      // Looks up at a bubble that's still floating, without a word.
      this.visited = [...this.visited.filter((v) => v !== id), id].slice(-REMEMBER_VISITS);
      const at = this.bubbles.position(id);
      if (at) {
        const spot = clampToRing({ x: at.x * 0.82, z: at.z * 0.82 }, 1.4, 7);
        await this.motor.walkTo(new THREE.Vector3(spot.x, 0, spot.z), signal, 0.7);
        await this.motor.faceToward(at, signal);
        this.bird.lookUp = 1;
        await a.wait(rand(2.5, 4.5), signal);
        this.bird.lookUp = 0;
      }
    } else if (roll < 0.75) {
      const p = clampToRing({ x: rand(-5, 5), z: rand(-2.5, 4.5) }, 1.6, 5.5);
      await this.motor.walkTo(new THREE.Vector3(p.x, 0, p.z), signal, 0.6);
    } else {
      // Sits by its spot for a while.
      await this.motor.walkTo(REST_SPOT, signal, 0.6);
      await this.motor.face(-0.4, signal);
      if (Math.random() < 0.3) {
        this.bird.beakOpen = 1;
        await a.wait(1.4, signal);
        this.bird.beakOpen = 0;
      }
    }
    if (Math.random() < MURMUR_CHANCE) this.say(pick(QUIET), 2.5);
    await a.wait(rand(4, 9), signal);
  }

  /** Thoughts it has taken into the page are floating away: it turns, looks up and waves them off. */
  private async watchGo(signal: AbortSignal): Promise<void> {
    const from = this.leaving[0];
    this.leaving = [];
    await this.motor.faceToward(from, signal);
    this.bird.lookUp = 1;
    this.bird.flap = 0.7;
    this.say(pick(SETTLED), 4);
    await this.animator.wait(1.3, signal);
    this.bird.flap = 0;
    await this.animator.wait(3, signal);
    this.bird.lookUp = 0;
  }

  /** The whole ritual: tear the page, carry it to the machine, and watch the bubble be born. */
  private async deliverNow(thought: Thought): Promise<void> {
    const a = this.animator;
    const b = this.bird;
    const m = this.motor;
    await m.walkTo(this.desk.standAt, undefined, 1.8);
    await m.face(this.desk.facing);
    b.typing = true;
    // A last flourish, then the full stop.
    for (let i = 0; i < 6; i++) {
      this.keystroke(thought.body.length);
      await a.wait(i === 4 ? 0.16 : 0.075);
    }
    b.typing = false;
    sound.ding();
    await a.wait(0.4);
    sound.rip();
    const page = this.desk.tearPage();
    page.rotation.y = Math.PI / 2;
    b.holder.add(page);
    b.lean = 0.2;
    await m.hop(1, 0.06);

    await m.walkTo(this.machine.standAt, undefined, 1.3);
    await m.face(Math.PI);
    b.lean = 1;
    await m.hop(1, 0.08);

    // Hand the page over to the machine's slot.
    const world = new THREE.Vector3();
    page.getWorldPosition(world);
    b.holder.remove(page);
    page.position.copy(world);
    // Edge-on to the slot, the way the bird was holding it (the slot runs left to right).
    page.rotation.set(0, Math.PI / 2, 0);
    b.root.parent?.add(page);
    page.geometry.computeBoundingBox();
    const box = page.geometry.boundingBox;
    await this.machine.takePage(page, box ? box.max.y - box.min.y : 0.24);
    page.parent?.remove(page);
    page.geometry.dispose();
    const pageMat = page.material as THREE.MeshStandardMaterial;
    pageMat.map?.dispose();
    pageMat.dispose();
    b.lean = 0;

    // Start thinking about it now: the brain needs a while and the bubble takes a while to form.
    const reaction = this.hooks.think(thought.id).catch(() => null);
    const swallowed = this.machine.swallow();
    await a.wait(0.4);
    await m.walkTo(new THREE.Vector3(1.9, 0, 1.6), undefined, 1.0);
    await m.faceToward(this.tube.mouth);
    b.lookUp = 0.6;
    await swallowed;

    this.lib.addThought(thought);
    const born = this.bubbles.spawn(thought, this.tube.mouth);
    void this.tube.rumble(1.9);
    b.lookUp = 0.9;
    await a.wait(1.75);

    // It popped free!
    b.flap = 1;
    sound.chirp(true);
    this.say(pick(JOY), 2.4);
    await m.hop(2, 0.14);
    b.flap = 0;
    await born;
    // The brain takes a while; the bird keeps gazing up at the bubble until its question arrives.
    const question = await Promise.race([reaction, a.wait(THINK_PATIENCE_S).then(() => null)]);
    if (question) {
      sound.chirp();
      this.say(question, QUESTION_S);
      await a.wait(4);
    }
    b.lookUp = 0;
    await a.wait(1.5);
  }

  // ---------- helpers ----------

  private until(signal: AbortSignal): Promise<void> {
    return new Promise((_, reject) => {
      if (signal.aborted) reject(new Cancelled());
      signal.addEventListener("abort", () => reject(new Cancelled()), { once: true });
    });
  }

  private say(text: string, seconds?: number): void {
    const s = seconds ?? Math.min(6, Math.max(2.5, text.length * 0.07));
    this.hooks.say(text, s);
    this.bird.talk(Math.min(1.6, text.length * 0.05));
  }
}
