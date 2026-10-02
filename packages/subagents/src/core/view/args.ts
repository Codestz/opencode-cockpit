/**
 * A call's arguments, drawn by what they are rather than squashed onto one line each:
 *
 *   pattern  loadConfig                       a short value: name, then value
 *   question                                  a long string: its name, then the text, as markdown
 *     ## What I need from you                 (verbatim for a file tool: code is not markdown)
 *     …
 *     … 41 more lines
 *   options                                   an object or a list: indented JSON
 *     {
 *       "tokens": 4000
 *     }
 *
 * Each argument shows at most `limit` rows and says what it hid — the same ladder as a call's output:
 * a few rows folded, more open, everything (nearly) with `a`. Pure, like the rest of `core/`.
 */

import { markdownRows } from "./markdown.ts"
import { fit, type Row, widthOf, wrap } from "./rows.ts"

/** Rows each argument shows while its call is folded. */
export const ARG_PREVIEW = 3

/** The widest a name column grows; a longer name pushes only its own value along. */
const NAME = 14

export type Style = "markdown" | "verbatim"

export interface Drawn {
  rows: Row[]
  /**
   * The rows the longest argument would take in full — a floor, not a count: what was never read
   * (past the cut) counts a row a line. Enough to say whether opening, or `a`, would show more.
   */
  most: number
}

/** Too long for the value column, or more than one line: drawn under its name instead. */
const long = (value: string, room: number) => value.length > room || value.includes("\n")

/** Whether a call's arguments are big enough that one line would hide most of them. */
export function large(input: Record<string, unknown>, width: number): boolean {
  const room = width - 6 - NAME - 2
  for (const value of Object.values(input)) {
    if (typeof value === "string" ? long(value, room) : typeof value === "object" && value !== null)
      return true
  }
  return false
}

/**
 * The first lines of `text`, enough for `limit` rows of `room` columns, and how many lines it left
 * unread. Cut before anything is measured or wrapped: a 10,000-line question folded to three rows
 * reads a dozen lines, not ten thousand (docs/building/measuring.md).
 */
export function headOf(text: string, limit: number, room: number): { head: string; rest: number } {
  /** A markdown fence or a blank run draws no row of its own, so read a few lines more than rows. */
  const want = limit * 2 + 4
  const chars = limit * Math.max(1, room)
  const lines: string[] = []
  let at = 0
  let cut = 0
  while (at <= text.length && lines.length < want) {
    const end = text.indexOf("\n", at)
    const stop = end < 0 ? text.length : end
    const line = text.slice(at, Math.min(stop, at + chars))
    /** A line too long to show even whole counts the rows its unread part would take. */
    if (stop - at > chars) cut += Math.ceil((stop - at - chars) / Math.max(1, room))
    lines.push(line)
    if (end < 0) {
      at = text.length + 1
      break
    }
    at = end + 1
  }
  let rest = cut
  if (at <= text.length) {
    rest += 1
    for (let next = text.indexOf("\n", at); next >= 0; next = text.indexOf("\n", next + 1)) rest += 1
  }
  return { head: lines.join("\n"), rest }
}

/** The rows a long value takes, at most `limit` of them, and the "… N more lines" it owes. */
function block(text: string, room: number, limit: number, style: Style): { rows: Row[]; total: number } {
  const { head, rest } = headOf(text, limit, room)
  const all: Row[] =
    style === "markdown"
      ? markdownRows(head, room, { indent: 2 })
      : wrap(head, room - 2).map((line) => fit([{ text: "  " }, { text: line, tone: "text" }], room))
  const total = all.length + rest
  const rows = all.slice(0, limit)
  const hidden = total - rows.length
  if (hidden > 0)
    rows.push(
      fit(
        [{ text: `  … ${hidden.toLocaleString("en")} more line${hidden === 1 ? "" : "s"}`, tone: "muted" }],
        room,
      ),
    )
  return { rows, total }
}

/**
 * Every argument of a call in `width` columns, each at most `limit` rows. `style` says how a long
 * string reads: a question or a prompt is markdown; a file's contents, or an old and new string to
 * swap, are code and stay exactly as written.
 */
export function argumentRows(
  input: Record<string, unknown>,
  width: number,
  limit: number,
  style: Style,
): Drawn {
  const names = Object.keys(input).filter((name) => input[name] !== undefined)
  const pad = Math.min(NAME, Math.max(0, ...names.map((name) => widthOf(name))))
  const room = Math.max(8, width - pad - 2)
  const rows: Row[] = []
  let most = 0
  for (const name of names) {
    const value = input[name]
    const scalar =
      typeof value === "string"
        ? long(value, room)
          ? undefined
          : value
        : typeof value === "object" && value !== null
          ? undefined
          : String(value)
    if (scalar !== undefined) {
      rows.push(
        fit(
          [
            { text: `${name.padEnd(pad)}  `, tone: "muted" },
            { text: scalar, tone: "text" },
          ],
          width,
        ),
      )
      most = Math.max(most, 1)
      continue
    }
    rows.push(fit([{ text: name, tone: "muted" }], width))
    const drawn =
      typeof value === "string"
        ? block(value, width, limit, style)
        : block(JSON.stringify(value, null, 2) ?? "", width, limit, "verbatim")
    rows.push(...drawn.rows)
    most = Math.max(most, drawn.total)
  }
  return { rows, most }
}
