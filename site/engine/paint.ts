/**
 * Rows → HTML. Every bay draws rows of runs; this only turns a run's tone *name* into a class
 * (`t-accent`, `f-selected`) — what that looks like is the site's theme, in engine.css. A bay that
 * carries its own colour (a program's output in Shell, an image in Review) keeps it inline.
 *
 * Review and Updater wrap a row as `{ runs }`; the rest are the runs themselves.
 */
export interface Run {
  text: string
  tone?: string
  fill?: string
  bold?: boolean
  faint?: boolean
  dim?: boolean
  italic?: boolean
  fg?: string
  bg?: string
  color?: string | number
  background?: string | number
}
export type AnyRow = readonly Run[] | { runs: readonly Run[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const hex = (c: string | number | undefined) => (typeof c === "number" ? `#${c.toString(16).padStart(6, "0")}` : c)

function run(r: Run): string {
  const cls = [
    r.tone && `t-${r.tone}`,
    r.bold && "b",
    (r.faint || r.dim) && "dim",
    r.italic && "i",
    r.fill && r.fill !== "none" && `f-${r.fill}`,
  ]
    .filter(Boolean)
    .join(" ")
  const fg = hex(r.fg ?? r.color)
  const bg = hex(r.bg ?? r.background)
  const style = fg || bg ? ` style="${fg ? `color:${fg};` : ""}${bg ? `background:${bg};` : ""}"` : ""
  return cls || style ? `<span${cls ? ` class="${cls}"` : ""}${style}>${esc(r.text)}</span>` : esc(r.text)
}

export function paint(rows: readonly AnyRow[]): string {
  return rows
    .map((row) => {
      const runs = "runs" in row ? row.runs : row
      return `<div class="ln">${runs.map(run).join("") || " "}</div>`
    })
    .join("")
}

/** A row of nothing, `width` wide. */
export const blank = (width: number): Run[] => [{ text: " ".repeat(width) }]
