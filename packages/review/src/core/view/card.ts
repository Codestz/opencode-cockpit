/**
 * A thread, drawn under the line it is about.
 *
 * A band, not a box and no longer a quote bar. A bordered box spends four glyphs and two columns per
 * line saying "this is a comment", and a quote bar — which this was — says it in one column but says
 * it *beside* the conversation rather than around it, so the thread still read as something laid on
 * top of the diff.
 *
 * A tinted row spanning the full width says the same thing with no characters at all: the band is the
 * boundary. It belongs to neither side of the diff, which is exactly what a conversation is, and the
 * eye reads a change of background faster than it reads any glyph.
 *
 * Inside it, two things carry meaning and nothing else does: a dim label saying where and how the
 * thread stands, and an inverted badge naming who is talking. The badge is solid-on-dark rather than
 * a coloured word, because a word in a colour is another thing to decode, while a badge is a label
 * you recognise without reading — and it costs no extra row.
 */

import { type Anchor, type Thread, threadWhere, waitingOn } from "../model/thread.ts"

/** Just the name of it: the card needs to know which of the three, not where the code went. */
type AnchorState = Anchor["state"]

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
}

const toneFor = (thread: Thread, state: AnchorState): Tone => {
  /** Gone is worse than moved, and reads as the colour of something you no longer have to act on. */
  if (state === "outdated") return "muted"
  if (state === "moved") return "warning"
  if (thread.status === "resolved") return "success"
  return waitingOn(thread) === "you" ? "warning" : "accent"
}

const statusWord = (thread: Thread, state: AnchorState): string => {
  /**
   * Resolved outranks everything the code has done since.
   *
   * A resolved thread whose quoted lines are gone is the *expected* ending, not a problem: the agent
   * changed the code, which is why it is resolved. Saying OUTDATED there erases the one word that
   * tells you the thread is finished — and it is what this panel drew after the first real run of
   * the loop, which is how the rule was found.
   */
  if (thread.status === "resolved") return "RESOLVED"
  /**
   * For anything still waiting, outdated replaces the status entirely. Such a thread is not waiting
   * on anybody — there is nothing left to do about it — and "WAITING · OUTDATED" invites a try.
   */
  if (state === "outdated") return "OUTDATED"
  const base = waitingOn(thread) === "you" ? "YOUR TURN" : "WAITING"
  return state === "moved" ? `${base} · MOVED` : base
}

/** The band's own surface. Neither an addition nor a deletion nor the pane behind it. */
const BAND: Fill = "comment"
/** The margin down the left of the band, where the focus edge lives. */
const LEDGE = 2
/** Badges sit in a column, so two turns of a conversation start at the same character. */
const BADGE = 8

export function cardHeight(thread: Thread, size: CardSize): number {
  return cardRows(thread, size).length
}

export function cardRows(
  thread: Thread,
  size: CardSize,
  anchor: AnchorState = "current",
  style: CardStyle = {},
): Row[] {
  const width = Math.max(20, size.width)
  const tone = toneFor(thread, anchor)
  const rows: Row[] = []

  /**
   * One row of the band, padded to the full width so the tint reaches both edges.
   *
   * The focused thread gets a single coloured column in its margin. That is the whole of the focus
   * treatment: a brighter band would fight the diff, and a border would be a box again.
   */
  const band = (runs: Run[]): Row => ({
    runs: clipRuns(
      [{ text: style.focused ? "▌" : " ", tone, fill: BAND }, { text: " ", fill: BAND }, ...runs],
      width,
      BAND,
    ),
  })

  /** Air at the top and bottom, in the band's own colour, so the thread has room to breathe. */
  const air = () => band([{ text: " ".repeat(Math.max(0, width - LEDGE)), fill: BAND }])

  rows.push(air())

  /**
   * Where it is, and how it stands — as a dim label and a badge, the way a heading works.
   *
   * Upper case and muted: it is the least important text in the band and should be read last, after
   * the conversation it introduces. The status is bracketed rather than coloured-in, so the only
   * solid blocks in the band are the names of who is speaking.
   */
  const where = (style.inline ? threadWhere(thread) : `${thread.file} · ${threadWhere(thread)}`).toUpperCase()
  const status = `[${statusWord(thread, anchor)}]`
  /**
   * The two sit together, not one at each end of the pane.
   *
   * Right-aligning the status left a void across the middle of every thread and made the eye travel
   * the width of the screen to learn one word. They belong to each other; they read as one phrase.
   */
  const label = cell(where, Math.max(1, width - LEDGE - status.length - 3))
  rows.push(
    band([
      { text: label.trimEnd(), tone: "muted", fill: BAND },
      { text: "  ", fill: BAND },
      { text: status, tone, bold: true, fill: BAND },
    ]),
  )
  rows.push(air())

  /** Each turn: a badge in its column, the words beside it, and wrapped lines hanging under them. */
  const room = Math.max(1, width - LEDGE - BADGE)
  thread.entries.forEach((entry, index) => {
    if (index > 0) rows.push(air())
    const agent = entry.author === "agent"
    const badge: Run = {
      text: agent ? " AGENT " : " YOU ",
      tone: "inverse",
      fill: agent ? "agent" : "you",
      bold: true,
    }
    wrapText(entry.body, room).forEach((line, at) => {
      rows.push(
        at === 0
          ? band([
              badge,
              { text: " ".repeat(Math.max(0, BADGE - badge.text.length)), fill: BAND },
              { text: cell(line, room), tone: "text", fill: BAND },
            ])
          : band([
              { text: " ".repeat(BADGE), fill: BAND },
              { text: cell(line, room), tone: "text", fill: BAND },
            ]),
      )
    })
  })

  /** Only the thread under the cursor says what you can do to it; the rest would be noise. */
  if (style.focused) {
    rows.push(air())
    rows.push(
      band([
        { text: " ".repeat(BADGE), fill: BAND },
        { text: "[c]", tone: "accent", bold: true, fill: BAND },
        { text: " Reply  ", tone: "muted", fill: BAND },
        { text: "[x]", tone: "accent", bold: true, fill: BAND },
        { text: " Remove", tone: "muted", fill: BAND },
      ]),
    )
  }
  rows.push(air())
  return rows
}
