// Everything the little bird can say without asking Claude.

export const BORED = [
  "nothing to do…",
  "*yaaawn*",
  "hm hm hmm…",
  "so… white. so empty.",
  "i could type something. if someone gave me something.",
  "do thoughts ever just… show up?",
  "i polished the typewriter. twice.",
  "*taps glasses*",
] as const;

export const IDLE = [
  "*hums*",
  "so many little worlds",
  "*adjusts glasses*",
  "ooh, they're drifting today",
  "i like it here",
] as const;

export const INSPECT = [
  "hmm… this one again",
  "this one feels heavy",
  "ooh, i remember this one",
  "there's something under this one",
  "*squints* interesting…",
  "i think this one wants a friend",
] as const;

export const LISTENING = ["i'm listening!", "go on, go on", "*ready at the keys*", "ooh, typing time"] as const;

export const JOY = ["another one!", "look at it go!", "welcome to the world, little thought", "yay!", "so shiny!"] as const;

export const POP = ["bye bye, little one", "*pop*", "let it go… there it goes"] as const;

export function pick<T>(lines: readonly T[], rand: () => number = Math.random): T {
  return lines[Math.floor(rand() * lines.length) % lines.length];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the last thought, or null when there are none. */
export function daysSince(lastIso: string | null, now: Date = new Date()): number | null {
  if (!lastIso) return null;
  const last = new Date(lastIso).getTime();
  if (Number.isNaN(last)) return null;
  return Math.max(0, Math.floor((now.getTime() - last) / DAY_MS));
}

/** What the bird says when you walk in. */
export function greeting(count: number, days: number | null): string {
  if (count === 0 || days === null) return "oh! hi. there's nothing here yet… tell me something?";
  if (days === 0) return count === 1 ? "hi again! your bubble's still floating" : "hi again!";
  if (days === 1) return "you're back! i kept an eye on the bubbles";
  if (days < 7) return `${days} days! i've been rereading your bubbles…`;
  if (days < 30) return "you're here!! i missed you. the bubbles missed you too";
  return "…is that you? it's been so long. i kept everything safe";
}
