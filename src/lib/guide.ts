// The words of the first-visit tour and of the guide behind the "?" button.
// Kept apart from the screen so they are easy to read, change and check.

export interface TourStep {
  title: string;
  text: string;
  /** The thing on screen this step is about (a CSS selector), ringed while the step shows. */
  target?: string;
}

export const TOUR: readonly TourStep[] = [
  {
    title: "hi. this is your mybrary",
    text: "Say what's on your mind. A little bird types it up, and it floats off as a bubble. Everything stays on this computer.",
  },
  {
    title: "say it here",
    text: "Write a thought, or tap the mic and just talk. Long and messy is fine. One thought at a time works best.",
    target: ".composer",
  },
  {
    title: "your bubbles",
    text: "Tap a bubble to read it. Drag it onto a shelf, or out of one. Tap a shelf to rename it and say what belongs there.",
  },
  {
    title: "the bird is your librarian",
    text: "It reads every bubble, sorts them onto shelves, links the ones that share something, and leaves you small steps. If it gets something wrong, just move it back. It never moves what you placed.",
  },
  {
    title: "it asks questions",
    text: "Tap a question to answer it (your answer becomes a bubble), or tap “not this one” and it won't ask that again.",
  },
  {
    title: "talk to the bird",
    text: "This button is just for the bird, and makes no bubble. Tell it something to remember, or end with a “?” and it answers from your bubbles.",
    target: ".whisper",
  },
  {
    title: "that's it",
    text: "The “?” up here brings this guide back any time, with a few do's and don'ts.",
    target: ".guide-open",
  },
];

export interface GuideSection {
  title: string;
  items: readonly string[];
}

export const GUIDE: readonly GuideSection[] = [
  {
    title: "🫧 bubbles",
    items: [
      "Write or talk, then send. The bird carries it to the machine and a bubble floats up.",
      "Tap a bubble to read it. “Let it go” pops it for good.",
      "Drag a bubble onto a shelf, or out onto the floor.",
      "Old bubbles fade. They brighten when you look at them.",
    ],
  },
  {
    title: "📚 shelves and links",
    items: [
      "The bird makes shelves and files bubbles on them. Tap a shelf to rename or recolour it.",
      "Every shelf has a “what belongs here” line. Rewrite it, and the bird sorts by your words.",
      "Open a bubble and tap “why here?” to see the bird's reason.",
      "Tap the word on a link to see why it's there. Pop it, and those two are never linked again.",
    ],
  },
  {
    title: "🐦 talking with the bird",
    items: [
      "It asks questions. Tap one to answer, or “not this one” to wave it away.",
      "The bird button next to the mic is just for the bird. No bubble is made.",
      "There, say anything for it to remember: “keep work and home apart”.",
      "Or end with “?” and it answers from your bubbles. The ones it used glow.",
      "Tap the bird's own shelf to see what it knows. Tap a line to correct it, × to make it forget.",
    ],
  },
  {
    title: "✅ small steps",
    items: [
      "The bird suggests small things to do, taken from what you wrote.",
      "Tick one when it's done, × if it isn't for you, “later” to see it again in a few days.",
    ],
  },
  {
    title: "🔍 finding things",
    items: [
      "The magnifier finds a word. Matching bubbles glow, and Enter flies from one to the next.",
      "Drag to look around, scroll or pinch to zoom.",
    ],
  },
];

export const DO: readonly string[] = [
  "Use names: people, projects, places. The bird learns them and keeps them apart.",
  "Correct the bird when it's wrong: drag, pop, ×, or tell it. It remembers.",
  "Give it a minute after a new bubble. It reads each one to the end before sorting.",
];

export const DONT: readonly string[] = [
  "Don't write notes to the bird as bubbles. Use the bird button, so they don't clutter your shelves.",
  "Don't expect it to know what you never wrote. It only goes by your bubbles, and says so when they don't answer.",
  "Don't tidy for it. Loose bubbles are fine; it sorts them when it has read them.",
];
