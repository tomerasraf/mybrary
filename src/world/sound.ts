// Every sound in the world is synthesized with Web Audio, so there are no files to load.

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = false;

const MUTE_KEY = "mind:muted";

export function loadMuted(): boolean {
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    muted = false;
  }
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Storage can be blocked; the toggle still works for this visit.
  }
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.8, ctx.currentTime, 0.05);
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function ready(): { c: Ctx; out: GainNode; t: number } | null {
  if (!ctx || !master || muted || ctx.state !== "running") return null;
  return { c: ctx, out: master, t: ctx.currentTime };
}

function env(c: Ctx, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noise(c: Ctx, t: number, duration: number): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.start(t, Math.random() * 0.5);
  src.stop(t + duration);
  return src;
}

function tone(c: Ctx, type: OscillatorType, t: number, duration: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.start(t);
  o.stop(t + duration);
  return o;
}

const vary = (base: number, spread: number) => base * (1 + (Math.random() * 2 - 1) * spread);

/** The bubble letting go: a wet, round pop. */
export function pop(size = 1): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const o = tone(c, "sine", t, 0.18);
  const f = vary(520, 0.15) / Math.sqrt(size);
  o.frequency.setValueAtTime(f * 1.9, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.09);
  o.connect(env(c, t, 0.5, 0.004, 0.12)).connect(out);

  const n = noise(c, t, 0.06);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2400;
  n.connect(hp).connect(env(c, t, 0.18, 0.002, 0.04)).connect(out);
}

/** Soft rising "bloop" while a bubble swells at the tube. */
export function swell(seconds = 1.4): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const o = tone(c, "sine", t, seconds + 0.1);
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(420, t + seconds);
  const lfo = tone(c, "sine", t, seconds + 0.1);
  lfo.frequency.value = 7;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain).connect(o.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + seconds * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.08);
  o.connect(g).connect(out);
}

/**
 * One typewriter key strike: the snap of the typebar on the page, the thunk of the key bottoming out,
 * and a faint ring from the machine's body. No two are quite alike. `space`: the duller, lower bar.
 */
export function clack(space = false): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const loud = vary(1, 0.18);

  const n = noise(c, t, 0.05);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = vary(space ? 1500 : 3400, 0.22);
  bp.Q.value = space ? 1.4 : 2.8;
  n.connect(bp).connect(env(c, t, (space ? 0.22 : 0.36) * loud, 0.001, space ? 0.05 : 0.03)).connect(out);

  const thump = tone(c, "triangle", t, 0.07);
  thump.frequency.setValueAtTime(vary(space ? 130 : 190, 0.12), t);
  thump.frequency.exponentialRampToValueAtTime(64, t + 0.055);
  thump.connect(env(c, t, (space ? 0.3 : 0.2) * loud, 0.001, 0.055)).connect(out);

  if (!space) {
    // The metal body answers, very quietly.
    const ring = tone(c, "sine", t, 0.12);
    ring.frequency.value = vary(2600, 0.3);
    ring.connect(env(c, t, 0.018 * loud, 0.002, 0.1)).connect(out);
  }
}

/** The carriage zipping back to the start of a new line, with its little bell. */
export function carriageReturn(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const o = tone(c, "sine", t, 0.9);
  o.frequency.value = 2349;
  o.connect(env(c, t, 0.07, 0.003, 0.8)).connect(out);

  const zip = noise(c, t + 0.05, 0.24);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 5;
  bp.frequency.setValueAtTime(900, t + 0.05);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.27);
  zip.connect(bp).connect(env(c, t + 0.05, 0.16, 0.02, 0.2)).connect(out);

  const stop = tone(c, "triangle", t + 0.27, 0.07);
  stop.frequency.setValueAtTime(150, t + 0.27);
  stop.frequency.exponentialRampToValueAtTime(70, t + 0.33);
  stop.connect(env(c, t + 0.27, 0.22, 0.001, 0.06)).connect(out);
}

/** The machine's rollers grabbing the page and pulling it in a little. */
export function tug(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const n = noise(c, t, 0.14);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 3;
  bp.frequency.setValueAtTime(vary(700, 0.1), t);
  bp.frequency.linearRampToValueAtTime(1500, t + 0.12);
  n.connect(bp).connect(env(c, t, 0.2, 0.01, 0.11)).connect(out);
  const motor = tone(c, "square", t, 0.13);
  motor.frequency.setValueAtTime(110, t);
  motor.frequency.linearRampToValueAtTime(150, t + 0.12);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  motor.connect(lp).connect(env(c, t, 0.05, 0.01, 0.11)).connect(out);
}

/** The carriage-return bell. */
export function ding(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  for (const [freq, gain] of [
    [2093, 0.16],
    [4186, 0.05],
    [5274, 0.03],
  ] as const) {
    const o = tone(c, "sine", t, 1.3);
    o.frequency.value = freq;
    o.connect(env(c, t, gain, 0.003, 1.2)).connect(out);
  }
}

/** Paper tearing off the roller. */
export function rip(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const n = noise(c, t, 0.25);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.linearRampToValueAtTime(4200, t + 0.2);
  n.connect(bp).connect(env(c, t, 0.2, 0.02, 0.2)).connect(out);
}

/** The thought machine swallowing a page: a fax-like warble. */
export function whir(seconds = 1.3): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const motor = tone(c, "sawtooth", t, seconds);
  motor.frequency.setValueAtTime(90, t);
  motor.frequency.linearRampToValueAtTime(120, t + seconds);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 600;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.1);
  g.gain.setValueAtTime(0.09, t + seconds - 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  motor.connect(lp).connect(g).connect(out);

  const beeps = [1300, 1650, 1300, 2100];
  beeps.forEach((freq, i) => {
    const bt = t + 0.15 + i * (seconds / 5);
    const b = tone(c, "square", bt, 0.12);
    b.frequency.value = freq;
    const bl = c.createBiquadFilter();
    bl.type = "lowpass";
    bl.frequency.value = 2500;
    b.connect(bl).connect(env(c, bt, 0.035, 0.005, 0.1)).connect(out);
  });
}

/** A tiny tweet. */
export function chirp(happy = false): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const notes = happy ? 3 : 1;
  for (let i = 0; i < notes; i++) {
    const st = t + i * 0.11;
    const o = tone(c, "sine", st, 0.1);
    const base = vary(2600, 0.08) + i * 300;
    o.frequency.setValueAtTime(base, st);
    o.frequency.exponentialRampToValueAtTime(base * 1.45, st + 0.06);
    o.connect(env(c, st, 0.09, 0.005, 0.08)).connect(out);
  }
}

/** A soft little footstep. */
export function step(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const o = tone(c, "sine", t, 0.05);
  o.frequency.setValueAtTime(vary(260, 0.15), t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.04);
  o.connect(env(c, t, 0.05, 0.002, 0.04)).connect(out);
}

/** A quiet glassy tap when you open a bubble. */
export function touch(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const o = tone(c, "sine", t, 0.5);
  o.frequency.value = vary(1320, 0.04);
  o.connect(env(c, t, 0.08, 0.004, 0.45)).connect(out);
  const o2 = tone(c, "sine", t, 0.4);
  o2.frequency.value = o.frequency.value * 1.5;
  o2.connect(env(c, t, 0.03, 0.004, 0.35)).connect(out);
}

/** A bubble squishing through a shelf's wall: a wet, low wobble. */
export function squish(size = 1): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const o = tone(c, "sine", t, 0.4);
  const f = vary(240, 0.12) / Math.sqrt(size);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.12);
  o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.34);
  const lfo = tone(c, "sine", t, 0.4);
  lfo.frequency.value = 22;
  const depth = c.createGain();
  depth.gain.value = f * 0.12;
  lfo.connect(depth).connect(o.frequency);
  o.connect(env(c, t, 0.22, 0.01, 0.32)).connect(out);
}

/** Little wingbeats as the bird takes off. */
export function flutter(beats = 4): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  for (let i = 0; i < beats; i++) {
    const st = t + i * 0.075;
    const n = noise(c, st, 0.05);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = vary(900, 0.2);
    bp.Q.value = 1.2;
    n.connect(bp).connect(env(c, st, 0.09, 0.004, 0.04)).connect(out);
  }
}
