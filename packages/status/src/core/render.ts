import { cutSegment, type Segment, segmentWidth } from "./segments.ts"

/**
 * Fitting the line to the terminal.
 *
 * Every statusline eventually meets a narrow window. Wrapping turns it into noise and a hard cut
 * loses whichever segments happen to sit on the right, so instead the lowest-priority segments are
 * dropped until what is left fits — the things you actually need (how full the context is, whether
 * something is retrying) survive a 60-column terminal, and the decorations do not.
 */

export interface FitResult {
  segments: Segment[]
  /** How many were dropped, so the line can say so. */
  dropped: number
}

export function lineWidth(segments: readonly Segment[], separator: string): number {
  if (segments.length === 0) return 0
  const text = segments.reduce((sum, s) => sum + segmentWidth(s), 0)
  return text + separator.length * (segments.length - 1)
}

export function fit(segments: readonly Segment[], width: number, separator: string): FitResult {
  if (width <= 0) return { segments: [], dropped: segments.length }
  const kept = [...segments]
  if (lineWidth(kept, separator) <= width) return { segments: kept, dropped: 0 }

  // Drop the least important first; ties break towards the end of the line, so the order a person
  // wrote their segments in still decides what goes.
  const order = kept
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.priority - b.segment.priority || b.index - a.index)

  const doomed = new Set<string>()
  for (const { segment } of order) {
    if (
      lineWidth(
        kept.filter((s) => !doomed.has(s.id)),
        separator,
      ) <= width
    )
      break
    doomed.add(segment.id)
  }

  const survivors = kept.filter((s) => !doomed.has(s.id))
  // Everything was dropped and it still does not fit: keep the most important one, cut to width.
  if (survivors.length === 0) {
    const best = order[order.length - 1]?.segment
    if (!best) return { segments: [], dropped: segments.length }
    return { segments: [cutSegment(best, width)], dropped: segments.length - 1 }
  }
  // A single survivor may still be wider than the terminal.
  const last = survivors[survivors.length - 1] as Segment
  if (survivors.length === 1 && segmentWidth(last) > width) {
    return { segments: [cutSegment(last, width)], dropped: doomed.size }
  }
  return { segments: survivors, dropped: doomed.size }
}

/**
 * Fitting a column. Height is the constraint rather than width, so segments are not merged onto a
 * row: each takes one, cut to the column's width, and the lowest-priority ones go when there are
 * more segments than rows.
 */
export function fitColumn(segments: readonly Segment[], width: number, maxRows: number): FitResult {
  if (width <= 0 || maxRows <= 0) return { segments: [], dropped: segments.length }
  const keep = new Set(
    [...segments]
      .map((segment, index) => ({ segment, index }))
      .sort((a, b) => b.segment.priority - a.segment.priority || a.index - b.index)
      .slice(0, maxRows)
      .map(({ segment }) => segment.id),
  )
  return {
    segments: segments.filter((segment) => keep.has(segment.id)).map((segment) => cutSegment(segment, width)),
    dropped: segments.length - keep.size,
  }
}
