// The local model shares the GPU with the 3D world, so the bird thinks one thing at a time.
// Pondering, sorting and musing all wait their turn here.

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
// One running, the background reader, and one more.
const MAX_WAITING = 3;

export class BusyError extends Error {
  constructor() {
    super("The bird is already thinking.");
    this.name = "BusyError";
  }
}

/** Runs `job` after any earlier ones. Throws BusyError when too much is already waiting. */
export async function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) throw new BusyError();
  waiting += 1;
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    waiting -= 1;
  }
}
