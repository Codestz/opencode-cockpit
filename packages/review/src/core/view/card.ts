/**
 * A thread, drawn under the line it is about.
 *
 * Quoted, not boxed. A bordered box spends four glyphs and two columns on every line to say "this is
 * a comment", leaves long empty rules across the screen, and has corners that align with nothing in a
 * diff. A bar down the left says the same thing in one column, and a terminal already reads that as
 * quotation — the same reason mail and markdown settled on it.
 *
 * The bar carries the status, so a review with something waiting on you looks different from a
 * finished one before you read a word of it.
 */

import { type Thread, threadWhere, waitingOn } from "../model/thread.ts"
import { cell, clipRuns, type Fill, type Row, type Run, type Tone, wrapText } from "./rows.ts"

export interface CardSize {
  width: number
  height: number
}

export interface CardStyle {
  /** Drawn inside the file it belongs to, so it need not name it. */
  inline?: boolean
  /** The thread the cursor is on: the only one that shows what you can do to it. */
  focused?: boolean
  /**
   * The tint of the line it is attached to.
   *
   * An added line is tinted and a comment on it was not, so the comment read as a layer laid over the
   * diff rather than as part of it. Sharing the tint is what makes it look attached.
   */
  fill?: Fill
}

const toneFor = (thread: Thread, drifted: boolean): Tone => {
  if (drifted) return "warning"
  if (thread.status === "resolved") return "success"
  return waitingOn(thread) === "you" ? "warning" : "accent"
}

const statusWord = (thread: Thread, drifted: boolean): string => {
  const base =
    thread.status === "resolved" ? "resolved" : waitingOn(thread) === "you" ? "your turn" : "waiting"
  return drifted ? `${base} · moved` : base
}

/** The bar, and the gap that separates it from what it is quoting. */
const BAR = "▎"
/** Author names sit in a column so two turns of a thread line up. */
const AUTHOR = 7

export function cardHeight(thread: Thread, size: CardSize): number {
  return cardRows(thread, size).length
}

export function cardRows(thread: Thread, size: CardSize, drifted = false, style: CardStyle = {}): Row[] {
  const width = Math.max(20, size.width)
  const tone = toneFor(thread, drifted)
  /** A conversation gets a surface of its own: neither an addition nor a deletion nor the pane. */
  const fill: Fill = style.fill ?? "comment"
  const rows: Row[] = []

  /** Everything is quoted, and nothing is allowed wider than the column it is quoted into. */
  const bar = (runs: Run[]): Row => ({
    runs: clipRuns([{ text: `${BAR} `, tone, bold: true, fill }, ...runs], width, fill),
  })

  /** What it is about on the left, where it stands on the right. Nothing in between. */
  const statusText = statusWord(thread, drifted)
  const full = style.inline ? threadWhere(thread) : `${thread.file} · ${threadWhere(thread)}`
  /** In a narrow column the path gives way: the lines are what identify a thread there. */
  const where = full.length > width - 4 - statusText.length ? threadWhere(thread) : full
  /**
   * Label and status together, not one at each end of the pane.
   *
   * Right-aligning the status left a void across the middle of every thread and made the eye travel
   * the width of the screen to learn one word. They belong to each other; they read as one phrase.
   */
  rows.push(
    bar([
      { text: where, tone: "text", bold: true, fill },
      { text: " · ", tone: "border", fill },
      { text: statusText, tone, fill },
    ]),
  )

  /**
   * Each turn: the author in its column, the words beside it. An author on a line of its own doubles
   * the height of a two-sentence thread and reads as a heading for nothing.
   */
  const room = width - 2 - AUTHOR
  thread.entries.forEach((entry, index) => {
    if (index > 0) rows.push(bar([{ text: " ".repeat(width - 2), fill }]))
    const who = entry.author === "agent" ? "agent" : "you"
    const whoTone: Tone = entry.author === "agent" ? "success" : "accent"
    wrapText(entry.body, room).forEach((line, at) => {
      rows.push(
        bar([
          { text: cell(at === 0 ? who : "", AUTHOR), tone: whoTone, bold: at === 0, fill },
          { text: cell(line, room), tone: "text", fill },
        ]),
      )
    })
  })

  /** Only the thread under the cursor says what you can do to it; the rest would be noise. */
  if (style.focused) {
    rows.push(
      bar([
        { text: cell("", AUTHOR), fill },
        { text: cell("r reply · x remove", room), tone: "muted", fill },
      ]),
    )
  }
  return rows
}
