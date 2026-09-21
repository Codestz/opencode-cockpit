/**
 * The numbers, said in one line.
 *
 * A footer rather than a separate screen: the interesting moment is the one where scrolling feels
 * wrong, and anything you have to leave the diff to read is a thing you read afterwards, when it is too
 * late to see what you were doing.
 */

import type { Count, Snapshot } from "../perf.ts"
import type { Run } from "./rows.ts"

/** Milliseconds, at the precision a terminal can act on. */
const ms = (value: number): string => (value >= 10 ? value.toFixed(0) : value.toFixed(2))

/** Thousands, because "18423 lines" is a number nobody reads. */
const many = (value: number): string =>
  value >= 10_000
    ? `${(value / 1000).toFixed(0)}k`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : `${value}`

/** How much of the work the row cache saved, which is the number that says whether it is working. */
export function hitRate(counts: Record<Count, number>): number | undefined {
  const asked = counts.hits + counts.builds
  return asked === 0 ? undefined : counts.hits / asked
}

/**
 * The footer line.
 *
 * Ordered by what a slow moment is usually about: the frame first, then what the frame had to build,
 * then whether anything is going wrong.
 */
export function statsRuns(snapshot: Snapshot): Run[] {
  const { counts, phases } = snapshot
  const label = (text: string): Run => ({ text, tone: "muted" })
  const value = (text: string): Run => ({ text, tone: "accent", bold: true })
  const runs: Run[] = [
    label(" paint "),
    value(`${ms(phases.paint.p50)}ms`),
    label(" p99 "),
    value(`${ms(phases.paint.p99)}`),
    label(" worst "),
    value(`${ms(phases.paint.worst)}`),
    label("  build "),
    value(`${ms(phases.build.p50)}ms`),
  ]

  const rate = hitRate(counts)
  if (rate !== undefined) runs.push(label("  cache "), value(`${Math.round(rate * 100)}%`))

  runs.push(
    label("  lines "),
    value(many(counts.lines)),
    label(" / "),
    value(many(counts.paints)),
    label(" paints"),
  )
  if (counts.coalesced > 0) runs.push(label("  dropped "), value(many(counts.coalesced)))
  /** Errors are the one number that should look wrong when it is not zero. */
  if (counts.errors > 0)
    runs.push({
      text: `  ${counts.errors} error${counts.errors === 1 ? "" : "s"}`,
      tone: "removed",
      bold: true,
    })
  return runs
}

/**
 * The same numbers as text, for a log file and for the preview CLI.
 *
 * Kept beside the footer version so the two cannot drift into disagreeing about what is worth saying.
 */
export function statsLines(snapshot: Snapshot): string[] {
  const { counts, phases } = snapshot
  const rate = hitRate(counts)
  return [
    `elapsed ${ms(snapshot.elapsed)}ms`,
    ...(["paint", "build", "layout"] as const).map(
      (phase) =>
        `${phase.padEnd(7)} runs ${String(phases[phase].runs).padStart(6)}  mean ${ms(phases[phase].mean).padStart(7)}ms  p50 ${ms(phases[phase].p50).padStart(7)}ms  p99 ${ms(phases[phase].p99).padStart(7)}ms  worst ${ms(phases[phase].worst).padStart(7)}ms`,
    ),
    `counts  ${(Object.keys(counts) as Count[]).map((name) => `${name} ${counts[name]}`).join("  ")}`,
    ...(rate === undefined
      ? []
      : [`cache   ${Math.round(rate * 100)}% of ${counts.hits + counts.builds} asks`]),
  ]
}
