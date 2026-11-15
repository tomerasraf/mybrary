// The bird may only say what is really in a bubble. These checks throw out anything it made up.

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** How much of a quote must really be in the text. Spoken bubbles get quoted a little loosely. */
const QUOTE_MATCH = 0.75;

/** How many words in a row must match: single common words are in every text. */
const RUN = 3;

/**
 * Whether a quote the model gave really comes from this text: most of its words are in it, and a few
 * of them stand next to each other the way they do in the text.
 */
export function grounded(quote: string, text: string): boolean {
  const q = wordsOf(quote);
  if (q.length === 0) return false;
  const body = wordsOf(text);
  const have = new Set(body);
  if (q.filter((w) => have.has(w)).length / q.length < QUOTE_MATCH) return false;
  const run = Math.min(RUN, q.length);
  const joined = ` ${body.join(" ")} `;
  for (let i = 0; i + run <= q.length; i++) {
    if (joined.includes(` ${q.slice(i, i + run).join(" ")} `)) return true;
  }
  return false;
}

/** Whether a name appears in the text, however it was spaced ("moon garden", "MoonGarden"). */
export function mentions(name: string, text: string): boolean {
  const key = squash(name);
  return key.length >= 2 && squash(text).includes(key);
}

/** One spelling for a name, so "Moon Garden" and "moongarden" are the same thing. */
export function nameKey(name: string): string {
  return squash(name);
}
