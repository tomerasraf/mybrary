import * as THREE from "three";
import type { TidyResult } from "@/lib/library";
import type { Step } from "@/lib/steps";
import type { Thought } from "@/lib/thoughts";
import { BORED, IDLE, INSPECT, JOY, LISTENING, PLANNING, SORTING, WRITING, pick } from "@/lib/bird/lines";
import { Animator, Cancelled, ease } from "./anim";
import type { Bird } from "./bird";
import type { Desk } from "./desk";
import { clampToRing } from "./layout";
import { Librarian } from "./librarian";
import type { LibraryScene } from "./library";
import { Motor } from "./motor";
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
  /** Ask the brain to tidy the library a little. It's saved already; the bird then acts it out. */
  tidy: () => Promise<TidyResult | null>;
  /** Ask the brain for one of the bird's own thoughts (saved in its nook). */
  muse: () => Promise<Thought | null>;
  /** Ask the brain for one small thing to do about a shelf. Null when it has nothing. */
  suggest: () => Promise<Step | null>;
  /** Something that keeps coming back in your bubbles, counted, not guessed. Null when there's nothing new. */
  pattern: () => Promise<{ line: string; ids: number[] } | null>;
  /** An old bubble to ask about. Null when none is old enough. */
  aging: () => Promise<{ id: number; line: string } | null>;
  /** Re-read the saved library and bring the world in line with it. */
  resync: () => void;
}

const BORED_SPOT = new THREE.Vector3(3.6, 0, 2.3);
const THINK_COOLDOWN_MS = 25_000;
/** Sometimes the bird just looks, without thinking out loud. */
const QUIET_CHANCE = 0.2;
/** How long the bird waits for its brain before giving up. */
const THINK_PATIENCE_S = 25;
/** Sorting and writing take the brain longer than a single line. Longer than the request's own timeout. */
const WORK_PATIENCE_S = 85;
const REMEMBER_VISITS = 6;
const TIDY_COOLDOWN_MS = 20_000;
/** After a tidy that changed nothing, the bird waits for something new (or this long). */
const TIDY_NOTHING_MS = 5 * 60_000;
const MUSE_COOLDOWN_MS = 4 * 60_000;
const MUSE_FIRST_MS = 90_000;
/** Without new bubbles, the bird still has a new thought this often. */
const MUSE_STALE_MS = 20 * 60_000;
const MUSE_MIN_BUBBLES = 3;
const STEP_FIRST_MS = 150_000;
const STEP_COOLDOWN_MS = 8 * 60_000;
/** When the bird had nothing to suggest (still reading, say), it tries again sooner. */
const STEP_RETRY_MS = 2 * 60_000;
const PATTERN_FIRST_MS = 60_000;
const PATTERN_COOLDOWN_MS = 6 * 60_000;
const DUST_FIRST_MS = 4 * 60_000;
const DUST_COOLDOWN_MS = 15 * 60_000;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Decides what the bird is doing, one behaviour at a time. */
export class Brain {
  private composing = false;
  private queue: Thought[] = [];
  private ctl = new AbortController();
  private disposed = false;
  private visited: number[] = [];
  private lastThink = 0;
  private lastTidy = 0;
  /** How many sortable bubbles there were when a tidy found nothing to do. */
  private tidyIdleAt: { count: number; at: number } | null = null;
  private lastMuse = Date.now() - MUSE_COOLDOWN_MS + MUSE_FIRST_MS;
  private museSeen = -1;
  private lastStep = Date.now() - STEP_COOLDOWN_MS + STEP_FIRST_MS;
  private lastPattern = Date.now() - PATTERN_COOLDOWN_MS + PATTERN_FIRST_MS;
  private lastDust = Date.now() - DUST_COOLDOWN_MS + DUST_FIRST_MS;
  private motor: Motor;
  private librarian: Librarian;

  constructor(
    private bird: Bird,
    private desk: Desk,
    private machine: ThoughtMachine,
    private tube: Tube,
    private lib: LibraryScene,
    private animator: Animator,
    private hooks: BrainHooks,
  ) {
    bird.root.position.copy(BORED_SPOT);
    bird.root.rotation.y = -0.6;
    bird.onStep = sound.step;
    this.motor = new Motor(bird, animator);
    this.librarian = new Librarian(bird, this.motor, lib, animator, (t, s) => this.say(t, s));
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
    this.say(pick(this.lib.personCount === 0 ? BORED : IDLE));
    void this.motor.hop(1, 0.1).catch(() => {});
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
        if (next) await this.deliverNow(next);
        else if (this.composing) await this.atDesk(signal);
        else if (this.lib.personCount === 0) await this.bored(signal);
        else if (this.wantsToTidy()) await this.tidyUp(signal);
        else if (this.wantsToSuggest()) await this.suggestStep(signal);
        else if (Date.now() - this.lastPattern > PATTERN_COOLDOWN_MS) await this.noticePattern(signal);
        else if (Date.now() - this.lastDust > DUST_COOLDOWN_MS) await this.dustOff(signal);
        else if (this.wantsToMuse()) await this.writeSomething(signal);
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
    b.flap = this.motor.airborne ? 0.4 : 0;
    b.beakOpen = 0;
    b.hopY = 0;
  }

  // ---------- the librarian ----------

  private wantsToTidy(): boolean {
    const loose = this.lib.sortableCount();
    const review = this.lib.reviewCount;
    const work = loose >= 2 || (loose === 1 && this.lib.shelfCount() > 0) || review > 0;
    if (!work || Date.now() - this.lastTidy < TIDY_COOLDOWN_MS) return false;
    const idle = this.tidyIdleAt;
    return !idle || idle.count !== loose + review || Date.now() - idle.at > TIDY_NOTHING_MS;
  }

  private wantsToMuse(): boolean {
    const n = this.lib.personCount;
    if (n < MUSE_MIN_BUBBLES || Date.now() - this.lastMuse < MUSE_COOLDOWN_MS) return false;
    return n !== this.museSeen || Date.now() - this.lastMuse > MUSE_STALE_MS;
  }

  private async tidyUp(signal: AbortSignal): Promise<void> {
    this.lastTidy = Date.now();
    const loose = this.lib.sortableCount() + this.lib.reviewCount;
    this.say(pick(SORTING), 2.5);
    const result = await this.whileThinking(this.hooks.tidy(), signal, WORK_PATIENCE_S, (late) =>
      this.librarian.snapAll(late.steps),
    );
    if (!result || result.steps.length === 0) {
      // Still reading some bubbles: it comes back to sort them soon. Otherwise it waits for something new.
      this.tidyIdleAt = result?.reading ? null : { count: loose, at: Date.now() };
      this.hooks.resync();
      return;
    }
    this.tidyIdleAt = null;
    try {
      await this.librarian.perform(result.steps, signal);
    } finally {
      // Anything the bird skipped (you moved it, a shelf popped) comes back in line with what was saved.
      this.hooks.resync();
    }
    await this.motor.land();
    if (result.line) {
      sound.chirp(true);
      this.say(result.line, 5);
      await this.motor.hop(2, 0.12);
    }
    await this.animator.wait(2, signal);
  }

  private wantsToSuggest(): boolean {
    return this.lib.shelfCount() > 0 && Date.now() - this.lastStep > STEP_COOLDOWN_MS;
  }

  /** Finds one small thing you could do about a shelf, flies over to it and says it. */
  private async suggestStep(signal: AbortSignal): Promise<void> {
    this.lastStep = Date.now();
    this.say(pick(PLANNING), 2.5);
    const step = await this.whileThinking(this.hooks.suggest(), signal, WORK_PATIENCE_S);
    if (!step) {
      this.lastStep = Date.now() - STEP_COOLDOWN_MS + STEP_RETRY_MS;
      return;
    }
    const shelf = step.clusterId !== null ? this.lib.clusters.get(step.clusterId) : undefined;
    if (shelf) {
      const spot = clampToRing({ x: shelf.pos.x * 0.82, z: shelf.pos.z * 0.82 }, 1.4, 7);
      await this.motor.walkTo(new THREE.Vector3(spot.x, 0, spot.z), signal, 0.9);
      await this.motor.faceToward(shelf.pos, signal);
      this.bird.lookUp = 1;
      this.lib.clusters.jiggle(shelf.id, 1.3);
    }
    sound.chirp(true);
    this.say(`a small step: ${step.body}`, 9);
    await this.motor.hop(2, 0.12);
    await this.animator.wait(6, signal);
    this.bird.lookUp = 0;
  }

  /** Walks over to a bubble and looks up at it. False when it can't be reached right now. */
  private async goLookAt(id: number, signal: AbortSignal): Promise<boolean> {
    const at = this.bubbles.isFloating(id) ? this.bubbles.position(id) : null;
    if (!at) return false;
    // Stand a little in front of the bubble (toward the centre) so you can see the bird look up at it.
    const spot = clampToRing({ x: at.x * 0.82, z: at.z * 0.82 }, 1.4, 7);
    await this.motor.walkTo(new THREE.Vector3(spot.x, 0, spot.z), signal, 0.75);
    await this.motor.faceToward(at, signal);
    this.bird.lookUp = 1;
    await this.animator.wait(0.8, signal);
    return true;
  }

  /** Something keeps coming back: the bird counted, and shows you the bubbles. */
  private async noticePattern(signal: AbortSignal): Promise<void> {
    this.lastPattern = Date.now();
    const found = await this.hooks.pattern().catch(() => null);
    if (!found || signal.aborted) return;
    const newest = [...found.ids].reverse().find((id) => this.bubbles.isFloating(id));
    if (newest === undefined || !(await this.goLookAt(newest, signal))) return;
    sound.chirp(true);
    this.say(found.line, 8);
    await this.animator.wait(2.5, signal);
    await this.pointOut(found.ids, signal);
    this.bird.lookUp = 0;
    await this.animator.wait(2, signal);
  }

  /** An old bubble: the bird dusts it off and asks if it's still true. */
  private async dustOff(signal: AbortSignal): Promise<void> {
    this.lastDust = Date.now();
    const old = await this.hooks.aging().catch(() => null);
    if (!old || signal.aborted) return;
    if (!(await this.goLookAt(old.id, signal))) return;
    this.bubbles.jiggle(old.id, 1.2);
    this.bubbles.setNoticed([old.id]);
    try {
      this.bird.flap = 0.6;
      await this.animator.wait(0.7, signal);
      this.bird.flap = 0;
      this.say(old.line, 10);
      await this.animator.wait(8, signal);
    } finally {
      this.bubbles.setNoticed([]);
      this.bird.lookUp = 0;
    }
  }

  private async writeSomething(signal: AbortSignal): Promise<void> {
    this.lastMuse = Date.now();
    this.museSeen = this.lib.personCount;
    this.say(pick(WRITING), 2.5);
    const thought = await this.whileThinking(this.hooks.muse(), signal, WORK_PATIENCE_S, (late) =>
      this.librarian.place(late),
    );
    if (!thought) {
      this.hooks.resync();
      return;
    }
    await this.librarian.writeDown(thought, signal);
  }

  /**
   * Lets the bird stroll while its brain works. Resolves with the answer, or null if it took too long.
   * If you interrupt, a late answer (already saved) goes to `onLate`, to be put in place quietly.
   */
  private async whileThinking<T>(
    work: Promise<T | null>,
    signal: AbortSignal,
    patience: number,
    onLate?: (late: T) => void,
  ): Promise<T | null> {
    const strollCtl = new AbortController();
    const stop = () => strollCtl.abort();
    signal.addEventListener("abort", stop, { once: true });
    const p = clampToRing({ x: rand(-4, 4), z: rand(-2, 4) }, 1.6, 5);
    const stroll = this.motor
      .walkTo(new THREE.Vector3(p.x, 0, p.z), strollCtl.signal, 0.5)
      .then(() => this.animator.wait(patience, strollCtl.signal))
      .then(
        () => null,
        () => null,
      );
    try {
      return await Promise.race([work, stroll]);
    } finally {
      stop();
      signal.removeEventListener("abort", stop);
      await stroll;
      if (signal.aborted) {
        if (onLate) void work.then((late) => late && onLate(late));
        throw new Cancelled();
      }
    }
  }

  // ---------- behaviours ----------

  private async atDesk(signal: AbortSignal): Promise<void> {
    await this.motor.walkTo(this.desk.standAt, signal, 1.7);
    await this.motor.face(this.desk.facing, signal);
    this.bird.typing = true;
    if (Math.random() < 0.5) this.say(pick(LISTENING), 2.5);
    await this.until(signal);
  }

  private async bored(signal: AbortSignal): Promise<void> {
    const a = this.animator;
    await this.motor.walkTo(BORED_SPOT, signal, 0.6);
    await this.motor.face(-0.4, signal);
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
      await this.motor.walkTo(p, signal, 0.4);
      await a.wait(1, signal);
    }
    await a.wait(rand(6, 11), signal);
  }

  private async roam(signal: AbortSignal): Promise<void> {
    if (Math.random() < 0.72) await this.inspect(signal);
    else {
      const p = clampToRing({ x: rand(-6, 6), z: rand(-3, 5) }, 1.6, 6);
      await this.motor.walkTo(new THREE.Vector3(p.x, 0, p.z), signal, 0.7);
      if (Math.random() < 0.35) this.say(pick(IDLE), 2.5);
      await this.animator.wait(rand(2, 5), signal);
    }
  }

  private async inspect(signal: AbortSignal): Promise<void> {
    // Ask the brain which bubble calls to it. While it thinks, the bird has a little wander.
    let result: Ponder | null = null;
    if (this.mayThink()) {
      this.say("hmm…", 2);
      result = await this.whileThinking(this.hooks.think({ mode: "wander", avoid: this.visited }), signal, THINK_PATIENCE_S);
    }
    const id = result && this.bubbles.isFloating(result.id) ? result.id : this.bubbles.randomFloating(this.visited.at(-1) ?? null);
    if (id === null) return;
    this.visited = [...this.visited.filter((v) => v !== id), id].slice(-REMEMBER_VISITS);
    const at = this.bubbles.position(id);
    if (!at) return;

    // Stand a little in front of the bubble (toward the centre) so you can see the bird look up at it.
    const spot = clampToRing({ x: at.x * 0.82, z: at.z * 0.82 }, 1.4, 7);
    await this.motor.walkTo(new THREE.Vector3(spot.x, 0, spot.z), signal, 0.75);
    await this.motor.faceToward(at, signal);
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
        if (p) await this.motor.faceToward(p, signal);
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
    const m = this.motor;
    await m.walkTo(this.desk.standAt, undefined, 1.8);
    await m.face(this.desk.facing);
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
    const slot = this.machine.slot;
    const from = world.clone();
    await a.tween(0.45, (k) => {
      page.position.lerpVectors(from, slot, k);
      page.position.y += Math.sin(k * Math.PI) * 0.08;
    });
    await a.tween(
      0.5,
      (k) => {
        page.position.set(slot.x, slot.y + 0.12 * (1 - k) - k * 0.2, slot.z);
        page.scale.y = 1 - k;
      },
      ease.in,
    );
    page.parent?.remove(page);
    page.geometry.dispose();
    (page.material as THREE.Material).dispose();
    b.lean = 0;

    // Start thinking about it now: the brain needs a few seconds and the bubble takes a while to form.
    const reaction = this.hooks.think({ mode: "new", id: thought.id });
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

  // ---------- helpers ----------

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
