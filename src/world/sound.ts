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

/** One typewriter key strike. */
export function clack(): void {
  const a = ready();
  if (!a) return;
  const { c, out, t } = a;
  const n = noise(c, t, 0.05);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = vary(3200, 0.25);
  bp.Q.value = 2.5;
  n.connect(bp).connect(env(c, t, 0.35, 0.001, 0.035)).connect(out);

  const thump = tone(c, "triangle", t, 0.06);
  thump.frequency.setValueAtTime(vary(180, 0.1), t);
  thump.frequency.exponentialRampToValueAtTime(70, t + 0.05);
  thump.connect(env(c, t, 0.22, 0.001, 0.05)).connect(out);
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
