/**
 * A thread, drawn where it belongs.
 *
 * Its own module because a comment is not a diff: it is prose, it has authors, it has a state, and it
 * has to be legible next to code without being mistaken for code. Keeping it apart means the box can
 * be redesigned — and it will be — without touching the file list or the diff.
 */

import { latest, type Thread, threadWhere, waitingOn } from "../model/thread.ts"
import { cell, clipRuns, type Fill, type Row, type Run, type Tone, wrapText } from "./rows.ts"

export interface NoteStyle {
  /** Hidden bodies, showing only the heading. Resolved threads start this way. */
  collapsed?: boolean
  /** Drawn as the thread the cursor is on. */
  focused?: boolean
  /** The code it was opened against has moved since. */
  drifted?: boolean
}

/**
 * Status is a colour *and* a word.
 *
 * A screen of finished threads should read as quiet rather than as noise to step over, and a screen
 * with something waiting on you should not need reading to notice.
 */
const toneFor = (thread: Thread, drifted: boolean): Tone => {
  if (drifted) return "warning"
  switch (thread.status) {
    case "resolved":
      return "muted"
    case "answered":
      return "warning"
    default:
      return "accent"
  }
}

const statusWord = (thread: Thread, drifted: boolean): string => {
  if (thread.status === "resolved") return drifted ? "resolved · moved" : "resolved"
  const waiting = waitingOn(thread)
  if (drifted) return waiting === "you" ? "your turn · moved" : "moved"
  return waiting === "you" ? "your turn" : "open"
}

/** The author's column, so two turns of a thread never run into each other. */
const AUTHOR = 6

/**
 * One line, for a thread that is finished.
 *
 * The point of resolving something is to stop reading it. A resolved thread keeps its place in the
 * file — you can see that line was discussed — and says nothing more until you open it.
 */
function collapsedRows(thread: Thread, indent: string, width: number, drifted: boolean): Row[] {
  const tone = toneFor(thread, drifted)
  const mark = thread.status === "resolved" ? "✓" : "•"
  const last = latest(thread)
  const head = `${mark} ${threadWhere(thread)} · ${statusWord(thread, drifted)} `
  /** `o` at the end, because a line of an answer is not the answer and the way back has to be visible. */
  const more = thread.entries.length > 0 ? " o opens " : ""
  const room = Math.max(0, width - indent.length - head.length - more.length - 1)
  const trailing = last ? cell(last.body, room) : " ".repeat(room)
  return [
    {
      target: thread.id,
      /** Clipped, because a heading plus a hint can outgrow a narrow column on its own. */
      runs: clipRuns(
        [
          { text: indent },
          { text: head, tone, fill: "panel" },
          { text: trailing, tone: "muted", fill: "panel" },
          { text: more, tone: "border", fill: "panel" },
        ],
        width,
        "panel",
      ),
    },
  ]
}

/**
 * A thread as a block under the line it is about.
 *
 * A single indented line read as part of the diff and the eye went straight past it. A bordered block
 * in the panel tint is unmistakably *not* code, which is the whole job: a review is a conversation
 * laid over a file and the two have to be told apart at a glance.
 */
export function noteRows(thread: Thread, width: number, style: NoteStyle = {}): Row[] {
  const indent = "  "
  const drifted = style.drifted ?? false
  if (style.collapsed ?? thread.status === "resolved") {
    return collapsedRows(thread, indent, width, drifted)
  }

  const tone = toneFor(thread, drifted)
  const fill: Fill = "panel"
  const box = Math.max(16, width - indent.length)
  const inner = box - 2

  const title = ` ${threadWhere(thread)} `
  const status = ` ${statusWord(thread, drifted)} `
  const rule = Math.max(0, inner - title.length - status.length)

  const rows: Row[] = [
    {
      target: thread.id,
      runs: [
        { text: indent },
        { text: style.focused ? "┏" : "╭", tone, fill },
        { text: title, tone, bold: true, fill },
        { text: "─".repeat(rule), tone, fill },
        { text: status, tone, bold: true, fill },
        { text: style.focused ? "┓" : "╮", tone, fill },
      ],
    },
  ]

  const edge = style.focused ? "┃" : "│"
  // indent + edge + space + author + body + edge has to come to the same width as the heading:
  // 2 + 1 + 1 + AUTHOR + room + 1 === 2 + 1 + inner + 1.
  const room = inner - AUTHOR - 1

  thread.entries.forEach((entry, index) => {
    if (index > 0) {
      rows.push({
        runs: [
          { text: indent },
          { text: edge, tone, fill },
          { text: " ".repeat(AUTHOR + 1), fill },
          { text: "─".repeat(Math.max(0, room)), tone: "border", fill },
          { text: edge, tone, fill },
        ],
      })
    }
    const who = entry.author === "agent" ? "agent" : "you"
    const whoTone: Tone = entry.author === "agent" ? "success" : "accent"
    wrapText(entry.body, room).forEach((text, at) => {
      rows.push({
        target: thread.id,
        runs: [
          { text: indent },
          { text: edge, tone, fill },
          { text: " " },
          { text: cell(at === 0 ? who : "", AUTHOR), tone: whoTone, bold: at === 0, fill },
          { text: cell(text, room), tone: "text", fill },
          { text: edge, tone, fill },
        ],
      })
    })
  })

  /**
   * The keys live on the box while it has the cursor, rather than in a footer nobody reads twice —
   * but only when the box is wide enough to hold them. A hint that overflows its own border is worse
   * than no hint, and in a narrow column the footer says nothing at all.
   */
  const full = " r reply · x resolve "
  const hint = style.focused && inner >= full.length ? full : ""
  rows.push({
    runs: [
      { text: indent },
      { text: style.focused ? "┗" : "╰", tone, fill },
      { text: "─".repeat(Math.max(0, inner - hint.length)), tone, fill },
      { text: hint, tone: "muted", fill },
      { text: style.focused ? "┛" : "╯", tone, fill },
    ],
  })
  return rows
}

/** Every run of a thread's rows, for asserting nothing draws wider than its column. */
export const noteWidth = (rows: readonly Row[]): number =>
  Math.max(0, ...rows.map((row) => row.runs.reduce((sum: number, run: Run) => sum + run.text.length, 0)))
