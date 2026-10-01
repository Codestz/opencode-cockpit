/**
 * Rows of styled runs — every Trust surface, pure so a test can measure it.
 *
 * Tones name a meaning, never a colour; `tui/render.ts` is the only place that knows what a tone
 * looks like, so the preview CLI and OpenCode draw the same rows (docs/building/terminal-ui.md).
 * The helpers are Subagents' (`core/view/rows.ts`), copied rather than imported: bays never import
 * each other.
 */

export type Tone = "text" | "muted" | "accent" | "info" | "tool" | "success" | "error" | "warning" | "border"

/** What sits behind a run: nothing, or the row under the cursor. */
export type Fill = "none" | "selected"

export interface Run {
  text: string
  tone?: Tone
  fill?: Fill
  bold?: boolean
  faint?: boolean
}

export type Row = Run[]

export const rowText = (row: Row): string => row.map((run) => run.text).join("")

/** Columns a string takes. Wide characters (CJK, most emoji) take two. */
export function widthOf(text: string, limit = Number.POSITIVE_INFINITY): number {
  let width = 0
  for (const char of text) {
    if (width > limit) return width
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
  if (widthOf(text, width) <= width) return text
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
 * A row exactly `width` columns wide: runs cut where they overflow, padded in the last run's fill
 * where they fall short. Every row every surface draws goes through here; the grid test holds it.
 */
export function fit(row: Row, width: number): Row {
  const out: Row = []
  let used = 0
  for (const run of row) {
    if (used >= width) break
    const room = width - used
    const w = widthOf(run.text, room)
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

/** Every run of a row on one surface: the row under the cursor. */
export const filled = (row: Row, fill: Fill): Row => row.map((run) => ({ ...run, fill }))

/** How long ago, in the fewest characters that still read: `now`, `5m`, `2h`, `3d`. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return "now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
