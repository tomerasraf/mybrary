// Everything the little bird can say without asking its brain.

/** The bird is quiet by default. Now and then it makes a small sound to itself: never a remark about your thoughts. */
export const QUIET = ["*hums*", "*adjusts glasses*", "*taps glasses*", "hm hm hmm…", "*fluffs feathers*"] as const;

/** You tapped the bird. */
export const POKED = ["*chirp*", "*tilts head*", "i'm here.", "i'm listening.", "*adjusts glasses*"] as const;

/** It took your thoughts into the page, and their bubbles float away. */
export const SETTLED = ["it's on the page now.", "got it. it's on the page.", "there. you can let that one go.", "*writes it down* there."] as const;

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
  // None of these end in a question mark: a greeting isn't a question to answer or wave away.
  if (count === 0 || days === null) return "oh! hi. there's nothing here yet… tell me something.";
  if (days === 0) return "hi again!";
  if (days === 1) return "you're back! tell me what's on your mind.";
  if (days < 7) return `${days} days! the page is where you left it.`;
  if (days < 30) return "you're here!! i missed you. tell me what's new.";
  return "…is that you? it's been so long. i kept the page safe";
}

// ---------- the librarian ----------

export const SORTING = [
  "let's tidy up a bit",
  "so many loose ones…",
  "hmm, where does everything go…",
  "*rolls up sleeves*",
  "time to sort!",
] as const;

export const NEW_SHELF = ["a new shelf!", "these need a home", "*puff puff puff*", "ta-da. a shelf."] as const;

export const FILED = ["in you go", "there.", "that's where you live now", "*squish*", "perfect fit"] as const;

export const WRITING = ["let me write something down…", "i'm having a thought…", "hold on, an idea…"] as const;

export const PLANNING = ["what could you do about these…", "let me find a small step…", "*taps beak, thinking*"] as const;

export const STEP_DONE = ["you did it! how did it go?", "done! what happened?", "one less thing to carry. how was it?"] as const;

/** You said the step on the page isn't for you. */
export const STEP_NOPE = ["ok. off the page.", "fair. i'll find a better one.", "*crosses it out*"] as const;

export const WROTE = ["wrote something for you. it's on my shelf", "a thought of my own! come read it", "i put a thought on my shelf"] as const;

// ---------- you, talking back ----------

/** You waved a question away. (None of these may end in a question mark.) */
export const WAVED = ["ok, not that one.", "fair. i won't ask that again.", "*crosses it out*", "oops. forget i asked."] as const;

/** You told the bird something, just for it. */
export const TOLD = ["got it. i'll remember.", "*writes it on its wing*", "noted, just for me.", "mm. i'll keep that in mind."] as const;

/** You asked the bird something: it goes to look. */
export const LOOKING = ["let me look…", "hold on, i'll check what you told me…", "*flips through its pages*"] as const;

/** Your bubbles don't answer what you asked. */
export const NO_ANSWER = [
  "you never said. i won't guess.",
  "i looked. it isn't in anything you told me yet.",
  "hm. you never told me that one.",
] as const;

/** You put a step off. */
export const LATER = ["ok. i'll bring it back in a few days.", "later it is.", "*tucks it under a wing*"] as const;
