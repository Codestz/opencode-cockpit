/**
 * What the review is actually doing, in numbers.
 *
 * Built because "it lags sometimes when I scroll" and "it crashes sometimes" are both unfalsifiable:
 * every fix for them is a guess, and a guess that happens to work teaches nothing. Counting is how a
 * guess becomes a measurement.
 *
 * Three rules keep it honest.
 *
 * **Always on.** A debug mode you have to remember to switch on is off during every problem worth
 * seeing. What toggles is the *display*, not the counting.
 *
 * **Per phase, never per row.** Timing a loop over fifty rows costs less than the loop; timing each of
 * the fifty costs more than the work. So `paint` and `build` are measured and nothing inside them is.
 *
 * **No allocation in the hot path.** Samples live in a `Float64Array` that never grows, and a snapshot
 * — which sorts, and does allocate — happens only when somebody looks.
 */

/** The things worth counting. A closed set, so a typo cannot quietly open a second counter. */
export type Count =
  /** Paints that reached the screen. */
  | "paints"
  /** Lines actually assigned to, which is the cost a paint really carries. */
  | "lines"
  /** Paints asked for and collapsed into another — the burst a fast scroll arrives as. */
  | "coalesced"
  /** Keys handled. */
  | "keys"
  /** Clicks and wheel events handled. */
  | "mouse"
  /** Diffs built row by row. */
  | "builds"
  /** Diffs answered from the row cache instead. */
  | "hits"
  /** Files counted for the stream's heights without being drawn. */
  | "measures"
  /** Things that threw, and were caught. */
  | "errors"

/** The things worth timing. */
export type Phase =
  /** Everything one frame costs: layout, then assignment. */
  | "paint"
  /** Turning a file into rows, which is the part the cache exists to avoid. */
  | "build"
  /** Composing the rows that are on screen, cache hit or not. */
  | "layout"

const COUNTS: Count[] = [
  "paints",
  "lines",
  "coalesced",
  "keys",
  "mouse",
  "builds",
  "hits",
  "measures",
  "errors",
]
const PHASES: Phase[] = ["paint", "build", "layout"]

/** Enough samples to see a shape, few enough to hold forever. */
const SAMPLES = 256

/** How long something took, over the samples still remembered. Milliseconds. */
export interface Spread {
  /** How many times it ran — all of them, not only the ones still sampled. */
  runs: number
  mean: number
  p50: number
  p99: number
  worst: number
}

export interface Snapshot {
  counts: Record<Count, number>
  phases: Record<Phase, Spread>
  /** Milliseconds since the meter was last reset, so a rate can be worked out from a count. */
  elapsed: number
}

export interface Meter {
  count: (name: Count, by?: number) => void
  /** Times `run`, whatever it returns — and still times it when it throws. */
  time: <T>(phase: Phase, run: () => T) => T
  snapshot: () => Snapshot
  reset: () => void
}

/** A fixed window of samples, oldest silently overwritten. */
interface Window {
  values: Float64Array
  /** Where the next sample goes. */
  at: number
  /** How many of the slots hold a real sample. */
  filled: number
  /** How many samples there have ever been, including the forgotten ones. */
  runs: number
  worst: number
}

const emptyWindow = (): Window => ({
  values: new Float64Array(SAMPLES),
  at: 0,
  filled: 0,
  runs: 0,
  worst: 0,
})

const quantile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) return 0
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  return sorted[at] as number
}

/**
 * A meter.
 *
 * The clock is an argument so a test can say what time it is; nothing else in here touches the outside
 * world, which is why the whole thing can be tested without a terminal.
 */
export function createMeter(clock: () => number = () => performance.now()): Meter {
  const counts = {} as Record<Count, number>
  const windows = {} as Record<Phase, Window>
  let since = clock()

  const wipe = () => {
    for (const name of COUNTS) counts[name] = 0
    for (const phase of PHASES) windows[phase] = emptyWindow()
    since = clock()
  }
  wipe()

  const record = (phase: Phase, spent: number) => {
    const window = windows[phase]
    window.values[window.at] = spent
    window.at = (window.at + 1) % SAMPLES
    window.filled = Math.min(SAMPLES, window.filled + 1)
    window.runs += 1
    if (spent > window.worst) window.worst = spent
  }

  const spread = (window: Window): Spread => {
    const held: number[] = []
    for (let index = 0; index < window.filled; index++) held.push(window.values[index] as number)
    held.sort((a, b) => a - b)
    const total = held.reduce((sum, value) => sum + value, 0)
    return {
      runs: window.runs,
      mean: held.length > 0 ? total / held.length : 0,
      p50: quantile(held, 0.5),
      p99: quantile(held, 0.99),
      worst: window.worst,
    }
  }

  return {
    count(name, by = 1) {
      counts[name] += by
    },
    time(phase, run) {
      const started = clock()
      try {
        return run()
      } finally {
        record(phase, clock() - started)
      }
    },
    snapshot() {
      return {
        counts: { ...counts },
        phases: {
          paint: spread(windows.paint),
          build: spread(windows.build),
          layout: spread(windows.layout),
        },
        elapsed: clock() - since,
      }
    },
    reset: wipe,
  }
}

/**
 * The one the running review uses.
 *
 * A module-level meter rather than one threaded through every signature: `diffRows` is four calls deep
 * in pure view code that has no business taking an instrumentation argument, and a parameter nobody can
 * usefully vary is not a seam, it is plumbing. Tests build their own with `createMeter`.
 */
export const metrics: Meter = createMeter()
