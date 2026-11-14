import * as THREE from "three";
import type { Thought } from "@/lib/thoughts";
import { BORED, IDLE, INSPECT, JOY, LISTENING, pick } from "@/lib/bird/lines";
import { Animator, Cancelled, ease, lerpAngle } from "./anim";
import type { Bird } from "./bird";
import type { BubbleField } from "./bubbles";
import type { Desk } from "./desk";
import { clampToRing, planPath, type Obstacle, type Vec2 } from "./layout";
import * as sound from "./sound";
import type { ThoughtMachine, Tube } from "./tube";

/** What the bird's brain came up with: the bubble it looks at, what it says, and bubbles it links to it. */
export interface Ponder {
  id: number;
  line: string;
  links: number[];
}

export type ThinkRequest = { mode: "new"; id: number } | { mode: "wander"; avoid: number[] };

export interface BrainHooks {
  say: (text: string, seconds: number) => void;
  /** Ask the bird's brain (local model, or Claude) for a thought. Resolves null when it can't. */
  think: (req: ThinkRequest) => Promise<Ponder | null>;
}

const OBSTACLES: Obstacle[] = [
  { x: 0, z: 0, r: 0.75 },
  { x: 1.25, z: 0.35, r: 0.6 },
  { x: 2.75, z: 1.25, r: 0.6 },
];
const BORED_SPOT = new THREE.Vector3(3.6, 0, 2.3);
const THINK_COOLDOWN_MS = 25_000;
/** Sometimes the bird just looks, without thinking out loud. */
const QUIET_CHANCE = 0.2;
/** How long the bird waits for its brain before giving up. */
const THINK_PATIENCE_S = 25;
const REMEMBER_VISITS = 6;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Decides what the bird is doing, one behaviour at a time. */
export class Brain {
  private composing = false;
  private queue: Thought[] = [];
  private ctl = new AbortController();
  private disposed = false;
  private visited: number[] = [];
  private lastThink = 0;

  constructor(
    private bird: Bird,
    private desk: Desk,
    private machine: ThoughtMachine,
    private tube: Tube,
    private bubbles: BubbleField,
    private animator: Animator,
    private hooks: BrainHooks,
  ) {
    bird.root.position.copy(BORED_SPOT);
    bird.root.rotation.y = -0.6;
    bird.onStep = sound.step;
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
    this.desk.setPaper(0.25 + textLength / 240);
    if (!this.bird.typing) return;
    this.bird.strike();
    this.desk.strike();
    sound.clack();
  }

  /** A thought was saved; the bird will carry it to the tube. Resolves when the bubble is born. */
  deliver(thought: Thought): void {
    this.queue.push(thought);
    this.interrupt();
  }

  /** You tapped the bird. */
  poke(): void {
    sound.chirp();
    this.say(pick(this.bubbles.count === 0 ? BORED : IDLE));
    void this.hop(1, 0.1).catch(() => {});
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
        const next = this.queue.shift();
        if (next) await this.deliverNow(next);
        else if (this.composing) await this.atDesk(signal);
        else if (this.bubbles.count === 0) await this.bored(signal);
        else await this.roam(signal);
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
    b.flap = 0;
    b.beakOpen = 0;
    b.hopY = 0;
  }

  // ---------- behaviours ----------

  private async atDesk(signal: AbortSignal): Promise<void> {
    await this.walkTo(this.desk.standAt, signal, 1.7);
    await this.face(this.desk.facing, signal);
    this.bird.typing = true;
    if (Math.random() < 0.5) this.say(pick(LISTENING), 2.5);
    await this.until(signal);
  }

  private async bored(signal: AbortSignal): Promise<void> {
    const a = this.animator;
    await this.walkTo(BORED_SPOT, signal, 0.6);
    await this.face(-0.4, signal);
    this.bird.slump = 1;
    const roll = Math.random();
    if (roll < 0.3) {
      this.bird.beakOpen = 1;
      this.say("*yaaawn*", 2);
      await a.wait(1.4, signal);
      this.bird.beakOpen = 0;
    } else if (roll < 0.75) {
      this.say(pick(BORED));
    } else {
      // A little aimless shuffle.
      this.bird.slump = 0;
      const p = BORED_SPOT.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0, rand(-0.6, 0.6)));
      await this.walkTo(p, signal, 0.4);
      await a.wait(1, signal);
    }
    await a.wait(rand(6, 11), signal);
  }

  private async roam(signal: AbortSignal): Promise<void> {
    if (Math.random() < 0.72) await this.inspect(signal);
    else {
      const p = clampToRing({ x: rand(-6, 6), z: rand(-3, 5) }, 1.6, 6);
      await this.walkTo(new THREE.Vector3(p.x, 0, p.z), signal, 0.7);
      if (Math.random() < 0.35) this.say(pick(IDLE), 2.5);
      await this.animator.wait(rand(2, 5), signal);
    }
  }

  private async inspect(signal: AbortSignal): Promise<void> {
    // Ask the brain which bubble calls to it. While it thinks, the bird has a little wander.
    const thought = this.mayThink() ? this.hooks.think({ mode: "wander", avoid: this.visited }) : null;
    let result: Ponder | null = null;
    if (thought) {
      this.say("hmm…", 2);
      // The stroll stops as soon as the thought arrives (or the person starts writing).
      const strollCtl = new AbortController();
      const stop = () => strollCtl.abort();
      signal.addEventListener("abort", stop, { once: true });
      const p = clampToRing({ x: rand(-4, 4), z: rand(-2, 4) }, 1.6, 5);
      const stroll = this.walkTo(new THREE.Vector3(p.x, 0, p.z), strollCtl.signal, 0.5)
        .then(() => this.animator.wait(THINK_PATIENCE_S, strollCtl.signal))
        .then(
          () => null,
          () => null,
        );
      try {
        result = await Promise.race([thought, stroll]);
      } finally {
        stop();
        signal.removeEventListener("abort", stop);
        await stroll;
      }
      if (signal.aborted) throw new Cancelled();
    }
    const id = result && this.bubbles.isFloating(result.id) ? result.id : this.bubbles.randomFloating(this.visited.at(-1) ?? null);
    if (id === null) return;
    this.visited = [...this.visited.filter((v) => v !== id), id].slice(-REMEMBER_VISITS);
    const at = this.bubbles.position(id);
    if (!at) return;

    // Stand a little in front of the bubble (toward the centre) so you can see the bird look up at it.
    const spot = clampToRing({ x: at.x * 0.82, z: at.z * 0.82 }, 1.4, 7);
    await this.walkTo(new THREE.Vector3(spot.x, 0, spot.z), signal, 0.75);
    await this.faceToward(at, signal);
    this.bird.lookUp = 1;
    await this.animator.wait(0.8, signal);

    const line = result?.id === id ? result.line : null;
    this.say(line ?? pick(INSPECT), line ? 7 : 3);
    await this.animator.wait(line ? 3 : rand(3, 5), signal);
    if (line && result) await this.pointOut(result.links, signal);
    this.bird.lookUp = 0;
    await this.animator.wait(rand(1.5, 3.5), signal);
  }

  /** Turns to look at bubbles the bird thinks belong together, and makes them glow for a moment. */
  private async pointOut(links: number[], signal?: AbortSignal): Promise<void> {
    const floating = links.filter((l) => this.bubbles.isFloating(l));
    if (floating.length === 0) {
      await this.animator.wait(3, signal);
      return;
    }
    this.bubbles.setNoticed(floating);
    sound.touch();
    try {
      for (const l of floating) {
        const p = this.bubbles.position(l);
        if (p) await this.faceToward(p, signal);
        await this.animator.wait(1.6, signal);
      }
      await this.animator.wait(1.2, signal);
    } finally {
      this.bubbles.setNoticed([]);
    }
  }

  /** The whole ritual: tear the page, carry it to the machine, and watch the bubble be born. */
  private async deliverNow(thought: Thought): Promise<void> {
    const a = this.animator;
    const b = this.bird;
    await this.walkTo(this.desk.standAt, undefined, 1.8);
    await this.face(this.desk.facing);
    b.typing = true;
    for (let i = 0; i < 5; i++) {
      this.keystroke(thought.body.length);
      await a.wait(0.07);
    }
    b.typing = false;
    sound.ding();
    await a.wait(0.35);
    sound.rip();
    const page = this.desk.tearPage();
    page.rotation.y = Math.PI / 2;
    b.holder.add(page);
    b.lean = 0.2;

    await this.walkTo(this.machine.standAt, undefined, 1.3);
    await this.face(Math.PI);
    b.lean = 1;
    await this.hop(1, 0.08);

    // Hand the page over to the machine's slot.
    const world = new THREE.Vector3();
    page.getWorldPosition(world);
    b.holder.remove(page);
    page.position.copy(world);
    page.rotation.set(0, 0, 0);
    b.root.parent?.add(page);
    const slot = this.machine.slot;
    const from = world.clone();
    await a.tween(0.45, (k) => {
      page.position.lerpVectors(from, slot, k);
      page.position.y += Math.sin(k * Math.PI) * 0.08;
    });
    await a.tween(0.5, (k) => {
      page.position.set(slot.x, slot.y + 0.12 * (1 - k) - k * 0.2, slot.z);
      page.scale.y = 1 - k;
    }, ease.in);
    page.parent?.remove(page);
    page.geometry.dispose();
    (page.material as THREE.Material).dispose();
    b.lean = 0;

    // Start thinking about it now: the brain needs a few seconds and the bubble takes a while to form.
    const reaction = this.hooks.think({ mode: "new", id: thought.id });
    const swallowed = this.machine.swallow();
    await a.wait(0.4);
    await this.walkTo(new THREE.Vector3(1.9, 0, 1.6), undefined, 1.0);
    await this.faceToward(this.tube.mouth);
    b.lookUp = 0.6;
    await swallowed;

    const born = this.bubbles.spawn(thought, this.tube.mouth);
    void this.tube.rumble(1.9);
    b.lookUp = 0.9;
    await a.wait(1.75);

    // It popped free!
    b.flap = 1;
    sound.chirp(true);
    this.say(pick(JOY), 2.4);
    await this.hop(2, 0.14);
    b.flap = 0;
    await born;
    // The brain can take a few seconds; the bird keeps gazing up until its thought arrives.
    const result = await Promise.race([reaction, a.wait(THINK_PATIENCE_S).then(() => null)]);
    if (result) {
      this.lastThink = Date.now();
      this.say(result.line, 7);
      await a.wait(3);
      await this.pointOut(result.links);
    }
    b.lookUp = 0;
    await a.wait(1.5);
  }

  // ---------- motor skills ----------

  private async walkTo(target: THREE.Vector3, signal?: AbortSignal, speed = 0.8): Promise<void> {
    const b = this.bird;
    const from: Vec2 = { x: b.root.position.x, z: b.root.position.z };
    const route = planPath(from, { x: target.x, z: target.z }, OBSTACLES);
    try {
      for (const p of route) {
        const start = b.root.position.clone();
        const end = new THREE.Vector3(p.x, 0, p.z);
        const dist = start.distanceTo(end);
        if (dist < 0.03) continue;
        await this.face(Math.atan2(end.x - start.x, end.z - start.z), signal, 0.18);
        b.moving = Math.min(1, speed);
        await this.animator.tween(dist / speed, (k) => b.root.position.lerpVectors(start, end, k), ease.linear, signal);
      }
    } finally {
      b.moving = 0;
    }
  }

  private async face(yaw: number, signal?: AbortSignal, seconds = 0.3): Promise<void> {
    const r = this.bird.root.rotation;
    const from = r.y;
    await this.animator.tween(seconds, (k) => (r.y = lerpAngle(from, yaw, k)), ease.inOut, signal);
  }

  private faceToward(p: THREE.Vector3, signal?: AbortSignal): Promise<void> {
    const at = this.bird.root.position;
    return this.face(Math.atan2(p.x - at.x, p.z - at.z), signal);
  }

  private async hop(times: number, height: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.animator.tween(0.32, (k) => (this.bird.hopY = Math.sin(k * Math.PI) * height), ease.linear);
    }
    this.bird.hopY = 0;
  }

  private until(signal: AbortSignal): Promise<void> {
    return new Promise((_, reject) => {
      if (signal.aborted) reject(new Cancelled());
      signal.addEventListener("abort", () => reject(new Cancelled()), { once: true });
    });
  }

  /** Whether the bird thinks out loud this time (it doesn't, too often). */
  private mayThink(): boolean {
    const now = Date.now();
    if (now - this.lastThink < THINK_COOLDOWN_MS || Math.random() < QUIET_CHANCE) return false;
    this.lastThink = now;
    return true;
  }

  private say(text: string, seconds?: number): void {
    const s = seconds ?? Math.min(6, Math.max(2.5, text.length * 0.07));
    this.hooks.say(text, s);
    this.bird.talk(Math.min(1.6, text.length * 0.05));
  }
}
