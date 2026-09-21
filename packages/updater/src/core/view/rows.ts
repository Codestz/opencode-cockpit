/**
 * The vocabulary the screens are built from: rows of styled runs, and no colours.
 *
 * The same rows are painted as ANSI by the CLI and drawn by the dialog, so there is one design, not
 * two that drift — the approach Review takes, with the handful of tones this screen needs.
 */

export type Tone =
  | "text"
  | "muted"
  /** A newer version, a spec being written. */
  | "added"
  /** Something being deleted, something that failed. */
  | "removed"
  /** A spec that will not move on its own; a registry that did not answer. */
  | "warning"

export type Fill =
  | "none"
  /** A plugin's heading in the review and the result: the band is the boundary, no box needed. */
  | "band"
  | "cursor"
  /** A key in the footer: recognised as a shape rather than read. */
  | "key"

export interface Run {
  text: string
  tone?: Tone
  fill?: Fill
  bold?: boolean
  /** Shown, but not something this screen can act on. */
  faint?: boolean
}

export interface Row {
  runs: Run[]
  /** The plugin a row stands for, so a click or a key knows what it landed on. */
  target?: string
}

export const rowWidth = (row: Row): number => row.runs.reduce((n, run) => n + run.text.length, 0)

/** Exactly `width` characters: padded, or cut with an ellipsis so a cut never looks whole. */
export function cell(text: string, width: number): string {
  if (width <= 0) return ""
  if (text.length <= width) return text.padEnd(width)
  return width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

/**
 * Exactly `width` characters, cut from the *left*: `…/opencode/tui.json` still says which file,
 * where `/private/tmp/cla…` says nothing (the rule in docs/building/terminal-ui.md).
 */
export function cellLeft(text: string, width: number): string {
  if (width <= 0) return ""
  if (text.length <= width) return text.padEnd(width)
  return width === 1 ? "…" : `…${text.slice(text.length - width + 1)}`
}

/** Clips a row's runs to `width` and pads it to exactly that, carrying the row's fill to the edge. */
export function fit(runs: readonly Run[], width: number, fill: Fill = "none"): Run[] {
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
    const dropped = run.text.slice(room)
    out.push(
      dropped.trim().length === 0
        ? { ...run, text: run.text.slice(0, room) }
        : { ...run, text: room > 1 ? `${run.text.slice(0, room - 1)}…` : "…" },
    )
    used = width
  }
  if (used < width) out.push({ text: " ".repeat(width - used), ...(fill === "none" ? {} : { fill }) })
  return out
}
