/**
 * Nothing in the review may take the session down, and nothing may fail in silence.
 *
 * Before this, `packages/review/src/tui/` contained no error handling at all: every command, every
 * click and every paint ran unguarded. A single row that threw — one file, one line, one state nobody
 * had hit before — either took the surface with it or was swallowed by the host, and both look
 * identical from the outside. That is what "it crashes sometimes" is made of, and why there was never a
 * stack to read.
 *
 * So every entry point runs through here. What went wrong is counted, kept for the footer, and handed
 * to `report` with everything that was true at the time. The review stays up with a broken row visible,
 * which is better than a pane that closes itself and takes the evidence with it.
 */

import type { Meter } from "./perf.ts"

export interface Trouble {
  /** Which entry point — a command name, `paint`, `mouse`. */
  where: string
  message: string
  stack?: string
  at: number
  /** How many times this same trouble has happened, reported once. */
  seen: number
}

export interface Guard {
  /** Runs `run`. If it throws, the throw stops here and `undefined` comes back. */
  run: <T>(where: string, run: () => T) => T | undefined
  /** The same, for something that returns a promise: a rejection is trouble too. */
  task: (where: string, run: () => Promise<unknown>) => void
  /** `run`, wrapped for later — for a table of commands that each need the same treatment. */
  wrap: <T>(where: string, run: () => T) => () => T | undefined
  /** The last thing that went wrong, for the footer to say so. */
  last: () => Trouble | undefined
  clear: () => void
}

export interface GuardOptions {
  meter: Meter
  /**
   * Where trouble goes — a toast, a log file, both. Called once per distinct trouble, never in a loop.
   * If it throws it is ignored: the thing that reports a problem may not become one.
   */
  report: (trouble: Trouble, detail: string) => void
  /** What was happening. Gathered only once something has already gone wrong, so it can cost what it likes. */
  context?: () => string
  /** How long the same trouble stays quiet after being reported. */
  quiet?: number
  now?: () => number
}

const QUIET = 5_000

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : typeof thrown === "string" ? thrown : JSON.stringify(thrown)

export function createGuard(options: GuardOptions): Guard {
  const now = options.now ?? (() => Date.now())
  const quiet = options.quiet ?? QUIET
  /** When each distinct trouble was last reported, so a row that throws every paint is said once. */
  const told = new Map<string, number>()
  let latest: Trouble | undefined

  const caught = (where: string, thrown: unknown) => {
    options.meter.count("errors")
    const message = messageOf(thrown)
    const key = `${where}: ${message}`
    const at = now()
    const before = latest?.where === where && latest.message === message ? latest.seen : 0
    latest = {
      where,
      message,
      at,
      seen: before + 1,
      ...(thrown instanceof Error && thrown.stack ? { stack: thrown.stack } : {}),
    }

    const said = told.get(key)
    if (said !== undefined && at - said < quiet) return
    told.set(key, at)

    const detail = [
      `${new Date(at).toISOString()}  ${where}`,
      message,
      ...(latest.stack ? [latest.stack] : []),
      ...(options.context ? [options.context()] : []),
      "",
    ].join("\n")
    try {
      options.report(latest, detail)
    } catch {
      /** Reporting failed. There is nowhere left to say so, and dropping it is better than a loop. */
    }
  }

  const guard: Guard = {
    run(where, run) {
      try {
        return run()
      } catch (thrown) {
        caught(where, thrown)
        return undefined
      }
    },
    task(where, run) {
      try {
        void run().catch((thrown: unknown) => caught(where, thrown))
      } catch (thrown) {
        caught(where, thrown)
      }
    },
    wrap(where, run) {
      return () => guard.run(where, run)
    },
    last: () => latest,
    clear() {
      latest = undefined
      told.clear()
    },
  }
  return guard
}
