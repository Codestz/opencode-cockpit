/**
 * What a drawn row is made of.
 *
 * The vocabulary every view module shares, and the reason none of them has to import another: a file
 * list, a diff and a comment thread all produce the same thing, so they can be written, tested and
 * changed apart from each other, and composed by whatever is arranging the screen.
 *
 * Nothing here knows about OpenTUI or about ANSI.
 */

/**
 * Tones, named for what they mean rather than for a colour. The diff and syntax ones map onto theme
 * keys OpenCode already ships (`diffAdded`, `syntaxKeyword`, `diffLineNumber`…), so a review looks
 * like the host's own diff rather than a second opinion about what green means.
 */
export type Tone =
  | "text"
  | "muted"
  | "accent"
  | "border"
  | "added"
  | "removed"
  | "hunk"
  | "lineNumber"
  | "success"
  | "warning"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "type"
  | "function"
  | "variable"
  | "operator"
  | "punct"

/** Backgrounds are separate: a changed line is tinted across its whole width, text or not. */
export type Fill = "none" | "added" | "removed" | "selected" | "panel"

export interface Run {
  text: string
  tone?: Tone
  fill?: Fill
  bold?: boolean
  italic?: boolean
  /**
   * An exact colour, when something knows better than a tone does.
   *
   * A real highlighter returns colours, not categories — so it sets this and the renderers prefer it
   * over `tone`. Untyped because this file is pure: it is the terminal library's own colour object,
   * carried through untouched.
   */
  color?: unknown
}

export interface Row {
  runs: Run[]
  /** Set on a row that is a line of the new file, so notes can attach to it. */
  line?: number
  /** The thing this row stands for — a path, a note id — so a click knows what it landed on. */
  target?: string
}

/** Pads or cuts to exactly `width` cells, so a column can never bleed into its neighbour. */
export function cell(text: string, width: number): string {
  if (width <= 0) return ""
  if (text.length === width) return text
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)
}

/** Elides from the left: the filename identifies a file, the directories are context. */
export function elidePath(path: string, width: number): string {
  if (width <= 1) return ""
  if (path.length <= width) return path
  return `…${path.slice(path.length - width + 1)}`
}

/**
 * Clips a line's runs to `width`, keeping their colours, and pads what is left.
 *
 * An earlier version swapped the whole line for one uncoloured string whenever it did not fit, which
 * is why a half-width pane looked unhighlighted: in a narrow column almost every line needs clipping,
 * so almost every line lost its colours. Truncation is a question about width and has nothing to say
 * about colour.
 */
export function clipRuns(runs: readonly Run[], width: number, fill: Fill = "none"): Run[] {
  if (width <= 0) return []
  const out: Run[] = []
  let used = 0
  for (const run of runs) {
    if (used >= width) break
    const room = width - used
    if (run.text.length <= room) {
      out.push(run)
      used += run.text.length
      continue
    }
    /** The last run standing gets an ellipsis, so a clipped line never pretends to be whole. */
    out.push({ ...run, text: room > 1 ? `${run.text.slice(0, room - 1)}…` : "…" })
    used = width
  }
  if (used < width) out.push({ text: " ".repeat(width - used), fill })
  return out
}

/** Wraps prose to a width, on word boundaries, because a note is prose and a diff line is not. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return []
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

/** Total width of a row, for asserting that nothing draws wider than the space it was given. */
export const rowWidth = (row: Row): number => row.runs.reduce((sum, run) => sum + run.text.length, 0)
