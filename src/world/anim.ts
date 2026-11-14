// Tiny coroutine-style animation helpers, driven by the world's clock.

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

export const ease = {
  linear: (k: number) => k,
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
  out: (k: number) => 1 - (1 - k) ** 3,
  in: (k: number) => k * k * k,
  back: (k: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
  },
  elastic: (k: number) =>
    k === 0 || k === 1 ? k : 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
};

interface Job {
  elapsed: number;
  duration: number;
  step: (k: number) => void;
  done: () => void;
  signal?: AbortSignal;
  fail: (e: Error) => void;
}

/** Runs tweens and waits off the render loop, so they pause with the tab and stay in sync. */
export class Animator {
  private jobs: Job[] = [];

  /** Calls `step` with an eased 0..1 for `duration` seconds. Rejects with Cancelled if the signal aborts. */
  tween(duration: number, step: (k: number) => void, easing = ease.inOut, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      this.jobs.push({
        elapsed: 0,
        duration: Math.max(duration, 1e-4),
        step: (k) => step(easing(k)),
        done: resolve,
        fail: reject,
        signal,
      });
    });
  }

  wait(seconds: number, signal?: AbortSignal): Promise<void> {
    return this.tween(seconds, () => {}, ease.linear, signal);
  }

  update(dt: number): void {
    if (this.jobs.length === 0) return;
    // Take the current list; anything scheduled from inside a callback lands in the fresh one.
    const current = this.jobs;
    this.jobs = [];
    const still: Job[] = [];
    for (const job of current) {
      if (job.signal?.aborted) {
        job.fail(new Cancelled());
        continue;
      }
      job.elapsed += dt;
      const k = Math.min(1, job.elapsed / job.duration);
      job.step(k);
      if (k >= 1) job.done();
      else still.push(job);
    }
    this.jobs = still.concat(this.jobs);
  }
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** Shortest-way angle interpolation. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Frame-rate independent smoothing toward a target. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}
