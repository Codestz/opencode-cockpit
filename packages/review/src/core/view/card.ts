/**
 * A thread, as a card over the diff.
 *
 * The first design put threads inline, between the lines they were about. It read well for one
 * sentence and badly for everything else: a reply pushed the code down, the box was as narrow as the
 * diff column, long prose wrapped to nothing, and "is this one folded" became a rule complicated
 * enough to have its own bugs.
 *
 * A card is what a pull request does, and for the same reasons. The diff keeps its shape — a marked
 * line says a thread is there — and the conversation gets a surface of its own, with room to be read
 * and somewhere obvious to put the things you can do about it.
 */

import { type Thread, threadWhere, waitingOn } from "../model/thread.ts"
import { cell, clipRuns, type Row, type Run, type Tone, wrapText } from "./rows.ts"

export interface CardSize {
  width: number
  height: number
}

export interface CardStyle {
  /**
   * Drawn inside the file it belongs to, which changes what is worth saying.
   *
   * A card sitting under line 41 of a file does not need to name that file, and the keys on it are
   * the ones that work where it is — repeating either is noise in the place you can least afford it.
   */
  inline?: boolean
}

const toneFor = (thread: Thread, drifted: boolean): Tone => {
  if (drifted) return "warning"
  if (thread.status === "resolved") return "success"
  return waitingOn(thread) === "you" ? "warning" : "accent"
}

const statusWord = (thread: Thread, drifted: boolean): string => {
  /**
   * Short, because it shares a heading with a file path. "waiting on the agent · code has moved" is
   * the honest sentence and also the one that pushes the important half of the heading off the card.
   */
  const base =
    thread.status === "resolved" ? "resolved" : waitingOn(thread) === "you" ? "your turn" : "waiting"
  return drifted ? `${base} · moved` : base
}

/**
 * How tall the card wants to be: as tall as its conversation, within what it was offered.
 *
 * A card sized to the pane would leave a short thread floating in empty space, and a card sized to
 * its content alone would push a long one off the screen.
 */
export function cardHeight(thread: Thread, size: CardSize): number {
  const room = size.width - 4
  const lines = thread.entries.reduce((sum, entry) => sum + wrapText(entry.body, room).length + 1, 0)
  return Math.max(6, Math.min(size.height, lines + 4))
}

/**
 * The card's rows: a heading, the conversation, and what you can do about it.
 *
 * Returned as its own block rather than drawn into the diff, so whoever is arranging the screen
 * decides where it floats.
 */
export function cardRows(thread: Thread, size: CardSize, drifted = false, style: CardStyle = {}): Row[] {
  const width = Math.max(24, size.width)
  const inner = width - 2
  const tone = toneFor(thread, drifted)
  const rows: Row[] = []

  const title = style.inline ? ` ${threadWhere(thread)} ` : ` ${thread.file} · ${threadWhere(thread)} `
  const status = ` ${statusWord(thread, drifted)} `
  rows.push({
    runs: clipRuns(
      [
        { text: "╭", tone, fill: "panel" },
        { text: title, tone: "text", bold: true, fill: "panel" },
        { text: "─".repeat(Math.max(0, inner - title.length - status.length)), tone, fill: "panel" },
        { text: status, tone, bold: true, fill: "panel" },
        { text: "╮", tone, fill: "panel" },
      ],
      width,
      "panel",
    ),
  })

  /** The conversation, with room to be prose. `│ ` + room + ` │` === `╭` + inner + `╮`. */
  const room = inner - 2
  const body: Row[] = []
  thread.entries.forEach((entry, index) => {
    const who = entry.author === "agent" ? "agent" : "you"
    const whoTone: Tone = entry.author === "agent" ? "success" : "accent"
    if (index > 0) {
      body.push({
        runs: [
          { text: "│ ", tone, fill: "panel" },
          { text: "·".repeat(Math.max(0, room)), tone: "border", fill: "panel" },
          { text: " │", tone, fill: "panel" },
        ],
      })
    }
    body.push({
      runs: [
        { text: "│ ", tone, fill: "panel" },
        { text: cell(who, room), tone: whoTone, bold: true, fill: "panel" },
        { text: " │", tone, fill: "panel" },
      ],
    })
    for (const line of wrapText(entry.body, room)) {
      body.push({
        runs: [
          { text: "│ ", tone, fill: "panel" },
          { text: cell(line, room), tone: "text", fill: "panel" },
          { text: " │", tone, fill: "panel" },
        ],
      })
    }
  })

  /** Taller than the room it has: the last thing said is what matters, so the top is what goes. */
  const space = Math.max(1, cardHeight(thread, { ...size, width }) - 3)
  const shown = body.length > space ? body.slice(body.length - space) : body
  if (body.length > space) {
    rows.push({
      runs: [
        { text: "│ ", tone, fill: "panel" },
        { text: cell(`… ${body.length - space} earlier lines`, room), tone: "muted", fill: "panel" },
        { text: " │", tone, fill: "panel" },
      ],
    })
  }
  rows.push(...shown)

  /** The keys that work where this card is: inline there is nothing to close but the review itself. */
  const keys = style.inline ? " r reply · x remove " : " r reply · x remove · esc close "
  rows.push({
    runs: clipRuns(
      [
        { text: "╰", tone, fill: "panel" },
        { text: "─".repeat(Math.max(0, inner - keys.length)), tone, fill: "panel" },
        { text: keys, tone: "muted", fill: "panel" },
        { text: "╯", tone, fill: "panel" },
      ],
      width,
      "panel",
    ),
  })
  return rows
}

/**
 * Floats a card over a block of rows.
 *
 * Whole rows are replaced rather than cells spliced into them: a terminal row here is a list of
 * styled runs, and cutting one in half to make room would mean rebuilding every run's colour around
 * the hole. A card that spans the column it floats over costs nothing and reads the same.
 */
export function floatOver(base: readonly Row[], card: readonly Row[], width: number): Row[] {
  const top = Math.max(0, Math.floor((base.length - card.length) / 2))
  const out = [...base]
  card.forEach((row, index) => {
    const at = top + index
    if (at < out.length) out[at] = { runs: clipRuns(row.runs as Run[], width, "panel") }
  })
  return out
}
