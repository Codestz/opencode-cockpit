/**
 * Rows of styled runs — the one drawing of every Subagents surface, pure so a test can measure it.
 *
 * Tones name a meaning, never a colour; `tui/render.ts` is the only place that knows what a tone
 * looks like, so the preview CLI and OpenCode draw the same rows (docs/building/terminal-ui.md).
 */

export type Tone = "text" | "muted" | "accent" | "info" | "tool" | "success" | "error" | "warning" | "border"

/** What sits behind a run: the header band, or the block a running call's output streams into. */
export type Fill = "none" | "band" | "block"

export interface Run {
  text: string
  tone?: Tone
  fill?: Fill
  bold?: boolean
  /** The terminal's DIM: thinking, and what is not the point. */
  faint?: boolean
}

export type Row = Run[]

export const rowText = (row: Row): string => row.map((run) => run.text).join("")

/** Columns a string takes. Wide characters (CJK, most emoji) take two. */
export function widthOf(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width +=
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd))
        ? 2
        : 1
  }
  return width
}

/** `text` in at most `width` columns, ending in `…` when cut. */
export function cut(text: string, width: number): string {
  if (width <= 0) return ""
  if (widthOf(text) <= width) return text
  let out = ""
  let used = 0
  for (const char of text) {
    const w = widthOf(char)
    if (used + w > width - 1) break
    out += char
    used += w
  }
  return `${out}…`
}

/**
 * A row exactly `width` columns wide: runs cut where they overflow, and padded — in the last run's
 * fill — where they fall short, so a band reaches both edges. Every row every surface draws goes
 * through here; the grid test holds it to it.
 */
export function fit(row: Row, width: number): Row {
  const out: Row = []
  let used = 0
  for (const run of row) {
    if (used >= width) break
    const room = width - used
    const w = widthOf(run.text)
    if (w <= room) {
      out.push(run)
      used += w
    } else {
      const text = cut(run.text, room)
      out.push({ ...run, text })
      used += widthOf(text)
      break
    }
  }
  if (used < width) {
    const last = out.at(-1)
    out.push({ text: " ".repeat(width - used), ...(last?.fill ? { fill: last.fill } : {}) })
  }
  return out
}

/** Left and right parts on one row, the right part flush against the edge; the left gives way. */
export function spread(left: Row, right: Row, width: number): Row {
  const rightWidth = widthOf(rowText(right))
  if (rightWidth >= width) return fit(right, width)
  const leftRoom = width - rightWidth - 1
  const shown = fit(left, leftRoom)
  const fill = right[0]?.fill ?? left.at(-1)?.fill
  return [...shown, { text: " ", ...(fill ? { fill } : {}) }, ...right]
}

/** Words onto lines of at most `width` columns; newlines in the text are kept; a long word breaks. */
export function wrap(text: string, width: number): string[] {
  const room = Math.max(1, width)
  const lines: string[] = []
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("")
      continue
    }
    let line = ""
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === "") continue
      if (widthOf(line) + widthOf(word) <= room) {
        line += word
        continue
      }
      if (line.trim() !== "") lines.push(line.trimEnd())
      line = /^\s+$/.test(word) ? "" : word
      while (widthOf(line) > room) {
        let head = ""
        for (const char of line) {
          if (widthOf(head) + widthOf(char) > room) break
          head += char
        }
        lines.push(head)
        line = line.slice(head.length)
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** A duration in the fewest characters that still reads: `4s`, `51s`, `2m04s`, `1h12m`. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}

/** `1.2k`, `24k`, `1.1M` — tokens in a narrow column. */
export function compact(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

/** A spinner frame, from a clock that ticks on every paint. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
export const spin = (frame: number): string => SPINNER[Math.abs(frame) % SPINNER.length] as string
