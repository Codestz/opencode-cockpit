/**
 * Rows of styled runs — every Trail surface, pure so a test can measure it.
 *
 * Tones name a meaning, never a colour; the interface's one render file is the only place that knows
 * what a tone looks like, so the preview CLI and OpenCode draw the same rows
 * (docs/building/terminal-ui.md). The helpers are Trust's (`core/view/rows.ts`), copied rather than
 * imported: bays never import each other.
 */

export type Tone =
  | "text"
  | "muted"
  | "accent"
  | "info"
  | "tool"
  | "success"
  | "error"
  | "warning"
  | "border"
  /** Text cut out of a solid fill (a focused button): the colour of what the dialog is drawn on. */
  | "ink"

/**
 * What sits behind a run. Two cover a whole row — the row under the cursor and the card's raised
 * panel — and the rest a few cells: an agent's chip, a button, a focused button, and the tinted
 * badges that say success, warning and error. A tint is the tone's colour faded into the dialog's
 * own, so it follows the theme (`TINTS`; `tui/render.ts` mixes it).
 */
export type Fill = "none" | "selected" | "panel" | "chip" | "button" | "buttonOn" | "ok" | "warn" | "err"

/** The fills that belong to a row rather than a run: what a row is padded with, and what a cursor replaces. */
const ROW_FILLS: ReadonlySet<Fill> = new Set<Fill>(["selected", "panel"])
const isRowFill = (fill: Fill | undefined): fill is Fill => fill !== undefined && ROW_FILLS.has(fill)

/**
 * The tinted fills: which tone each is made of, and how much of it is mixed into the dialog's
 * background. Little enough that the tone's own text on it stays legible; enough to be seen.
 */
export const TINTS: Readonly<Record<"chip" | "ok" | "warn" | "err", { tone: Tone; amount: number }>> = {
  chip: { tone: "info", amount: 0.12 },
  ok: { tone: "success", amount: 0.16 },
  warn: { tone: "warning", amount: 0.16 },
  err: { tone: "error", amount: 0.16 },
}

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
    const fill = rowFillOf(out)
    out.push({ text: " ".repeat(width - used), ...(fill ? { fill } : {}) })
  }
  return out
}

/** The fill a row is drawn on: the last row-wide fill among its runs. A chip at its end is not one. */
export function rowFillOf(row: Row): Fill | undefined {
  for (let i = row.length - 1; i >= 0; i--) {
    const fill = row[i]?.fill
    if (isRowFill(fill)) return fill
  }
  return undefined
}

/** Left and right parts on one row, the right part flush against the edge; the left gives way. */
export function spread(left: Row, right: Row, width: number): Row {
  const rightWidth = widthOf(rowText(right))
  if (rightWidth >= width) return fit(right, width)
  const leftRoom = width - rightWidth - 1
  const shown = fit(left, leftRoom)
  const fill = rowFillOf([...left, ...right])
  return [...shown, { text: " ", ...(fill ? { fill } : {}) }, ...right]
}

/**
 * A row on one surface — the row under the cursor, the card's panel. A run with a fill of its own
 * (a chip, a badge, a button) keeps it: the surface is what is behind them.
 */
export const filled = (row: Row, fill: Fill): Row =>
  row.map((run) =>
    run.fill === undefined || run.fill === "none" || isRowFill(run.fill) ? { ...run, fill } : run,
  )

/**
 * The row under the cursor: `▌` in its first cell — the margin every row keeps for it — and the
 * selected fill to both edges (docs/building/design-system.md: `▌` is the cursor and nothing else).
 */
export function cursorRow(row: Row, width: number): Row {
  const [first, ...rest] = row
  const trimmed = !first
    ? []
    : widthOf(first.text) > 1
      ? [{ ...first, text: [...first.text].slice(1).join("") }, ...rest]
      : rest
  return filled(fit([{ text: "▌", tone: "accent" }, ...trimmed], width), "selected")
}

/**
 * How long ago, in the fewest characters that still read: `now`, `5m`, `2h`, `3d`. In a column of
 * times, "ago" on every one says nothing.
 */
export function age(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return "now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** The same in a sentence: `just now`, `5m ago`. */
export const ago = (ms: number): string => {
  const said = age(ms)
  return said === "now" ? "just now" : `${said} ago`
}
