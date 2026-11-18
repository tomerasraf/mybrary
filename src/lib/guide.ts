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
    title: "hi. empty your head here",
    text: "Say what's on your mind and leave lighter. A little bird listens and keeps one short page for you. Everything stays on this computer.",
  },
  {
    title: "say it here",
    text: "Write a thought, or tap the mic and just talk. Long and messy is fine. You never have to read it again.",
    target: ".composer",
  },
  {
    title: "the bird asks one question",
    text: "When your thought floats up as a bubble, the bird may ask one question about it. Tap it to answer, or “not this one” and it won't ask that again. Often it just stays quiet.",
  },
  {
    title: "then the bubble floats away",
    text: "After a minute the bird takes your thought into its page and the bubble drifts off. Nothing is lost. An empty sky means your head is clear.",
  },
  {
    title: "the page is all you read",
    text: "A few lines on what's on your mind right now, and one small step. The bird rewrites it every time you say something new.",
    target: ".mindpage",
  },
  {
    title: "talk to the bird",
    text: "This button is just for the bird, and makes no bubble. Tell it something to remember, or end with a “?” and it answers from what you've said.",
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
    title: "🫧 saying things",
    items: [
      "Write or talk, then send. The bird carries it to the machine and a bubble floats up.",
      "A bubble floats only until the bird has taken it into the page. Then it drifts up and away.",
      "Tap a floating bubble to read it. “Let it go” deletes that thought for good.",
    ],
  },
  {
    title: "📄 the page",
    items: [
      "“On your mind” is the only thing to read: a few lines, each one thing and where it stands.",
      "The bird rewrites it after every new thought. Old things drop off when newer ones push them out.",
      "“One small step” comes from something you said you want to do. Tick it when it's done, × if it isn't for you.",
      "Tap the page's title to fold it away, and again to bring it back.",
    ],
  },
  {
    title: "🐦 the bird",
    items: [
      "It asks one question per thought, at most. Tap to answer, or “not this one” to wave it away.",
      "Otherwise it keeps quiet. It doesn't comment on what you said.",
      "The bird button next to the mic is just for the bird. No bubble is made.",
      "There, say anything for it to remember: “Dana is my sister”.",
      "Or end with “?” and it answers from everything you've told it.",
    ],
  },
  {
    title: "🔍 looking back",
    items: [
      "You don't have to. But the magnifier finds a word in anything you ever said, and opens it.",
      "Drag to look around, scroll or pinch to zoom.",
    ],
  },
];

export const DO: readonly string[] = [
  "Talk the way you think: rambling is fine. The bird reads for what you mean.",
  "Use names: people, projects, places. The page uses your names for things.",
  "Give it a minute after a new thought. The bird reads it to the end before it rewrites the page.",
];

export const DONT: readonly string[] = [
  "Don't tidy, sort or reread. That's the bird's job now, and the page is the result.",
  "Don't write notes to the bird as thoughts. Use the bird button, so they stay off your page.",
  "Don't expect it to know what you never said. It only goes by your words, and says so when they don't answer.",
];
