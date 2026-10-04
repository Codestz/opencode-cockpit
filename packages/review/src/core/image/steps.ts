/**
 * Long work, cut into slices that give the event loop back between them.
 *
 * The TUI is one thread: a 2880×1800 PNG takes ~50 ms to unfilter in JavaScript, and inside OpenCode
 * the pair took 114 ms — a 16 ms frame seven times over (docs/opencode/images.md). So the decoders are
 * generators that `yield` every few milliseconds of work, and the caller decides what a yield means:
 * nothing at all in a test or the preview CLI, a turn of the event loop in the pane.
 */

export type Steps<T> = Generator<void, T, void>

/** Pixels of work per slice: about 3–5 ms of unfiltering or LZW on a laptop. */
export const SLICE = 256 * 1024

/** Runs every slice now. For tests, the CLI, and anything already off the interface thread. */
export function finish<T>(steps: Steps<T>): T {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** A macrotask, so a paint queued meanwhile gets its turn before the next slice. */
export const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Runs the slices with the event loop's turn between each. */
export async function finishSoon<T>(steps: Steps<T>, pause: () => Promise<void> = turn): Promise<T> {
  let next = steps.next()
  while (!next.done) {
    await pause()
    next = steps.next()
  }
  return next.value
}
