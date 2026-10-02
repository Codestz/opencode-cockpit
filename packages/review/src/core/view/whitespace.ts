/**
 * Whitespace you can see, where it is the change.
 *
 * `−const a = 1` above `+const a = 1` is two identical rows and no explanation: the reader cannot tell
 * what changed, or whether the tool is broken. So where whitespace is what differs, it is drawn — a
 * `·` for a space, a `→` for a tab, a `␍` for a carriage return — and only there. Visible whitespace
 * across a whole file is noise that hides the code; inside the part of a line that changed, it is the
 * change.
 *
 * Tabs and carriage returns are also the two characters a row cannot carry raw. A tab jumps to the
 * terminal's next stop and a carriage return goes back to the start of the line, and either takes the
 * grid with it — so every line is drawn through `displayText`, whether anything is marked on it or not.
 *
 * Pure: hunks in, column positions out.
 */

import type { Hunk } from "../diff/hunks.ts"

/** Columns a tab advances to. Four is the width most editors and pull requests draw one at. */
export const TAB_STOP = 4

/** What each marked character is drawn as. One column each, and none of them ambiguous in width. */
const SHOWN: Record<string, string> = { " ": "·", "\t": "→", "\r": "␍" }

const isSpace = (char: string) => char === " " || char === "\t" || char === "\r"

/** Character ranges of a line, `[from, to)`, whose whitespace is drawn. */
export type Marks = readonly (readonly [number, number])[]

export interface HunkWhitespace {
  /** Marks per line, by the line's index in the hunk. Lines with none are absent. */
  marks: Map<number, Marks>
  /** Every change in the hunk is a change of whitespace and nothing else. */
  only: boolean
}

const squeeze = (text: string) => text.replace(/\s/g, "")

/** Trailing spaces and tabs: invisible, and the most common whitespace a linter complains about. */
function trailing(text: string): [number, number] | undefined {
  let end = text.length
  if (text.endsWith("\r")) end--
  let from = end
  while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from--
  return from < end ? [from, end] : undefined
}

/**
 * Where two lines stop agreeing: the part between their common start and their common end.
 *
 * `const a = 1` and `const a = 1 ` share everything but the last space, so that space is the only
 * thing marked — not the spaces between the words, which did not change.
 */
function differing(before: string, after: string): { before: [number, number]; after: [number, number] } {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  return { before: [head, before.length - tail], after: [head, after.length - tail] }
}

const add = (marks: Map<number, [number, number][]>, index: number, range: [number, number] | undefined) => {
  if (!range || range[0] >= range[1]) return
  const list = marks.get(index) ?? []
  list.push(range)
  marks.set(index, list)
}

/**
 * The whitespace worth drawing in a hunk.
 *
 * A run of removed lines followed by added ones is paired line for line, the way a reader compares
 * them. A pair that is equal once whitespace is taken out is a whitespace change: its differing part
 * is marked on both rows. Trailing spaces on any changed line are marked as well. The hunk is
 * whitespace-only when every changed line is in such a pair and nothing is left over.
 */
export function hunkWhitespace(hunk: Hunk): HunkWhitespace {
  const marks = new Map<number, [number, number][]>()
  const { lines } = hunk
  let only = true
  let changed = false
  let index = 0
  while (index < lines.length) {
    if (lines[index]?.kind === "context") {
      index++
      continue
    }
    changed = true
    const removed: number[] = []
    const added: number[] = []
    while (index < lines.length && lines[index]?.kind !== "context") {
      if (lines[index]?.kind === "remove") removed.push(index)
      else added.push(index)
      index++
    }
    if (removed.length !== added.length) only = false
    for (const [at, gone] of removed.entries()) {
      const came = added[at]
      const was = lines[gone]?.text ?? ""
      const now = came === undefined ? undefined : lines[came]?.text
      if (now === undefined || came === undefined || squeeze(was) !== squeeze(now)) {
        only = false
        continue
      }
      const range = differing(was, now)
      add(marks, gone, range.before)
      add(marks, came, range.after)
    }
    for (const at of [...removed, ...added]) add(marks, at, trailing(lines[at]?.text ?? ""))
  }
  return { marks, only: changed && only }
}

/** Is the character at `at` inside one of `marks`, and whitespace? */
const marked = (text: string, at: number, marks: Marks | undefined): boolean => {
  if (!marks) return false
  const char = text[at] as string
  if (!isSpace(char)) return false
  for (const [from, to] of marks) if (at >= from && at < to) return true
  return false
}

/**
 * A line as it is drawn: tabs expanded to their stop, carriage returns dropped, and the marked
 * whitespace replaced by its glyph. `shown` lists the columns that hold a glyph, so they can be toned
 * apart from the code around them.
 */
export function displayText(text: string, marks?: Marks): { text: string; shown: number[] } {
  if (!marks && !text.includes("\t") && !text.includes("\r")) return { text, shown: [] }
  let out = ""
  const shown: number[] = []
  for (let at = 0; at < text.length; at++) {
    const char = text[at] as string
    const visible = marked(text, at, marks)
    if (visible) shown.push(out.length)
    if (char === "\t") {
      const width = TAB_STOP - (out.length % TAB_STOP)
      out += (visible ? "→" : " ") + " ".repeat(width - 1)
    } else if (char === "\r") {
      if (visible) out += SHOWN["\r"]
    } else out += visible ? (SHOWN[char] ?? char) : char
  }
  return { text: out, shown }
}

/** How many columns a line takes once drawn. */
export const displayWidth = (text: string): number =>
  text.includes("\t") || text.includes("\r") ? displayText(text).text.length : text.length
