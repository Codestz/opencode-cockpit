/**
 * The two rows at the top and the two at the bottom.
 *
 * Fixed height, always: the body is measured from them, so a header or footer that grew by a row
 * would shove the diff about every time something happened. Everything either of them has to say —
 * trouble, the performance numbers, a selection — *replaces* what is there rather than adding to it.
 */

import { type ChangeSet, progress, type Review } from "../model/review.ts"
import type { Columns } from "./geometry.ts"
import { clipRuns, type Fill, type Row, type Run, rowWidth } from "./rows.ts"
import type { ViewState } from "./state.ts"

/** The bar across the top: what you are reading, and how far through it you are. */
export function headerRows(changes: ChangeSet, review: Review, width: number, label?: string): Row[] {
  const seen = progress(changes, review)
  /**
   * The bay names itself once, as a badge rather than a word.
   *
   * Solid-on-dark is how the eye finds the top-left of a pane without reading it, and it lets the
   * branch beside it be the brightest *text* on the row — which is the thing you actually came to
   * check.
   */
  const left: Run[] = [
    { text: " review ", tone: "inverse", fill: "you", bold: true },
    { text: "  ", fill: "panel" },
    { text: `${label ?? changes.source}`, tone: "text", bold: true, fill: "panel" },
    { text: "  ", fill: "panel" },
    { text: `+${seen.additions}`, tone: "added", fill: "selected" },
    { text: " ", fill: "selected" },
    { text: `−${seen.deletions}`, tone: "removed", fill: "selected" },
  ]
  /** What is left to do, in the order you run out of it: read it, answer it, finish it. */
  const bar = (): Run => ({ text: "  │  ", tone: "border", fill: "panel" })
  const right: Run[] = [
    { text: `${seen.read}/${seen.files} read`, tone: "muted", fill: "panel" },
    bar(),
    { text: `${seen.open} open`, tone: seen.open > 0 ? "accent" : "muted", fill: "panel" },
    ...(seen.threads > seen.open
      ? [
          bar(),
          { text: `${seen.threads - seen.open} resolved`, tone: "muted" as const, fill: "panel" as Fill },
        ]
      : []),
    { text: " ", fill: "panel" },
  ]
  const used = rowWidth({ runs: left })
  const tail = rowWidth({ runs: right })
  return [
    {
      runs: clipRuns(
        [...left, { text: " ".repeat(Math.max(0, width - used - tail)), fill: "panel" }, ...right],
        width,
        "panel",
      ),
    },
    { runs: [{ text: "─".repeat(width), tone: "border" }] },
  ]
}

/** The keys, on screen, because a surface whose keys are undiscoverable has none. */
export function footerRows(width: number, _columns: Columns, state: ViewState = {}): Row[] {
  const inDiff = state.pane === "diff"
  const selecting = inDiff && state.anchor !== undefined
  const lines =
    selecting && state.line !== undefined && state.anchor !== undefined
      ? Math.abs(state.line - state.anchor) + 1
      : 0

  /**
   * `[key] Label`, with the key bright and the label dim.
   *
   * A run-on string of `tab files  j/k line  v select` is a sentence you have to parse; a bracketed
   * key is a shape you recognise. The brackets do the work a colour would otherwise have to do, which
   * keeps the only saturated colours in the pane on the diff where they mean something.
   */
  const hint = (key: string, label: string): Run[] => [
    { text: `[${key}]`, tone: "accent", bold: true },
    { text: ` ${label}`, tone: "muted" },
    { text: "   " },
  ]

  /**
   * The keys you always have, then the ones this moment adds.
   *
   * An earlier version replaced the whole line whenever the cursor was near a thread, so moving and
   * selecting — the things you do constantly — disappeared behind two keys you use occasionally. A
   * hint that hides the basics to advertise the extras has it backwards.
   */
  const moving: Run[] = [
    { text: " " },
    ...hint("Tab", inDiff ? "Files" : "Diff"),
    ...hint("j/k", "Navigate"),
    ...(inDiff ? hint("v", "Select") : []),
  ]

  const extra: Run[] = selecting
    ? [
        { text: `${lines} line${lines === 1 ? "" : "s"}   `, tone: "accent", bold: true },
        ...hint("c", "Note Them"),
        ...hint("v", "Cancel"),
      ]
    : state.thread
      ? [...hint("c", "Reply"), ...hint("x", "Remove")]
      : [
          ...hint("c", inDiff ? "Note Line" : "Note File"),
          ...(inDiff ? hint("f", "Note File") : []),
          ...hint("space", "Read"),
        ]

  const tail: Run[] = [
    ...hint("s", "Submit"),
    ...hint("b", "Source"),
    ...hint("w", "Width"),
    ...hint("q", "Close"),
  ]

  /**
   * One line, and a queue for it: trouble, then numbers, then the keys.
   *
   * The footer stays exactly two rows however much it has to say, because the body's height is measured
   * from it — a footer that grew would push the diff about every time something went wrong.
   */
  const said: Run[] = state.notice
    ? [
        { text: " ! ", tone: "removed", bold: true },
        { text: state.notice, tone: "removed" },
      ]
    : state.stats
      ? [...state.stats]
      : [...moving, ...extra, ...tail]

  return [{ runs: [{ text: "─".repeat(width), tone: "border" }] }, { runs: clipRuns(said, width, "none") }]
}
