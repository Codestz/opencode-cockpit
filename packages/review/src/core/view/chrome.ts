/**
 * The two rows at the top and the two at the bottom.
 *
 * Fixed height, always: the body is measured from them, so a header or footer that grew by a row
 * would shove the diff about every time something happened. Everything either of them has to say —
 * trouble, the performance numbers, a selection — *replaces* what is there rather than adding to it.
 */

import { closeHint, fitHints, GLYPH, HINT_GAP, type Hint } from "@opencode-cockpit/client/design"
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
  /**
   * With nothing changed, every count is a zero, and a row of zeros says nothing the body's sentence
   * does not say better. The badge and the source are all there is.
   */
  const empty = changes.files.length === 0
  const left: Run[] = [
    { text: " review ", tone: "inverse", fill: "you", bold: true },
    { text: "  ", fill: "panel" },
    { text: `${label ?? changes.source}`, tone: "text", bold: true, fill: "panel" },
    ...(empty
      ? []
      : [
          { text: "  ", fill: "panel" as Fill },
          { text: `+${seen.additions}`, tone: "added" as const, fill: "selected" as Fill },
          { text: " ", fill: "selected" as Fill },
          { text: `−${seen.deletions}`, tone: "removed" as const, fill: "selected" as Fill },
        ]),
  ]
  /** What is left to do, in the order you run out of it: view it, answer it, finish it. */
  const bar = (): Run => ({ text: "  │  ", tone: "border", fill: "panel" })
  const right: Run[] = empty
    ? [{ text: " ", fill: "panel" }]
    : [
        { text: `${seen.read}/${seen.files} viewed`, tone: "muted", fill: "panel" },
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
export function footerRows(width: number, _columns: Columns, state: ViewState = {}, empty = false): Row[] {
  const inDiff = state.pane === "diff"
  const selecting = inDiff && state.anchor !== undefined
  const lines =
    selecting && state.line !== undefined && state.anchor !== undefined
      ? Math.abs(state.line - state.anchor) + 1
      : 0

  /**
   * `[key] Label`, with the key bright and the label dim — the shape every bay writes its keys in
   * (client/design).
   *
   * A run-on string of `tab files  j/k line  v select` is a sentence you have to parse; a bracketed
   * key is a shape you recognise. The brackets do the work a colour would otherwise have to do, which
   * keeps the only saturated colours in the pane on the diff where they mean something.
   *
   * The keys you always have come first, then the ones this moment adds. An earlier version replaced
   * the whole line whenever the cursor was near a thread, so moving and selecting — the things you do
   * constantly — disappeared behind two keys you use occasionally.
   */
  const moving: Hint[] = [
    { key: "tab", label: inDiff ? "Files" : "Diff" },
    { key: "j/k", label: "Navigate" },
    ...(inDiff ? [{ key: "v", label: "Select" }] : []),
  ]
  const extra: Hint[] = selecting
    ? [
        { key: "c", label: "Note Them" },
        { key: "v", label: "Cancel" },
      ]
    : state.thread
      ? [
          { key: "c", label: "Reply" },
          { key: "x", label: "Remove" },
        ]
      : [
          { key: "c", label: inDiff ? "Note Line" : "Note File" },
          ...(inDiff ? [{ key: "f", label: "Note File" }] : []),
          { key: "space", label: "Viewed" },
          ...(inDiff ? [{ key: "z", label: "Fold" }] : []),
        ]

  /**
   * Submit says how much there is to submit.
   *
   * The key stays on screen at zero rather than disappearing: a key that comes and goes cannot be
   * learned, and this row exists to teach the keys. Dimmed and without a number it reads as "nothing
   * to hand over", which is both true and exactly what pressing it will say.
   */
  const submit: Hint = state.waiting
    ? { key: "s", label: `Submit ${state.waiting}` }
    : { key: "s", label: "Submit", off: true }
  const sources: Hint[] = [
    { key: "b", label: "Source" },
    /** Shift-b: what the branch is compared against. Named here, or nobody finds it. */
    { key: "B", label: "Base" },
  ]
  /** `esc`, as every bay closes; `q` still does too, for the hands that learned it. */
  const close = closeHint()
  const rule: Row = { runs: [{ text: "─".repeat(width), tone: "border" }] }

  /**
   * One line, and a queue for it: trouble, then numbers, then the keys.
   *
   * The footer stays exactly two rows however much it has to say, because the body's height is measured
   * from it — a footer that grew would push the diff about every time something went wrong.
   */
  if (state.notice) {
    const trouble: Run[] = [
      { text: ` ${GLYPH.warn} `, tone: "error", bold: true },
      { text: state.notice, tone: "error" },
    ]
    return [rule, { runs: clipRuns(trouble, width, "none") }]
  }
  if (state.stats) return [rule, { runs: clipRuns([...state.stats], width, "none") }]

  /**
   * Nothing to review: only the keys that act. Moving, noting and marking have nothing to land on,
   * and a row that offers them anyway teaches that its keys do not always mean anything.
   */
  if (empty) return [rule, { runs: keyRow([], [...sources, close], width) }]
  /** A selection says how many lines it holds before the keys that act on them. */
  const lead: Run[] = selecting
    ? [{ text: `${lines} line${lines === 1 ? "" : "s"}`, tone: "accent", bold: true }]
    : []
  return [
    rule,
    {
      runs: keyRow(
        lead,
        [...moving, ...extra, submit, ...sources, { key: "w", label: "Width" }, close],
        width,
      ),
    },
  ]
}

/**
 * The keys, cut to the width with the way out kept.
 *
 * Clipping the row from the right made `[q] Close` the first key to go — at a hundred columns it was
 * already gone — and "how do I leave" is the first question anyone asks of a surface that has taken
 * over the screen. The shared fitter keeps the way out, cuts at a key's edge and says `…` when it
 * did; this only places it a column in from the edge, after anything the moment leads with.
 */
function keyRow(lead: readonly Run[], hints: readonly Hint[], width: number): Run[] {
  const before: Run[] = [{ text: " " }, ...lead, ...(lead.length > 0 ? [{ text: " ".repeat(HINT_GAP) }] : [])]
  const room = Math.max(0, width - rowWidth({ runs: before }))
  return clipRuns([...before, ...fitHints(hints, room).runs], width, "none")
}
