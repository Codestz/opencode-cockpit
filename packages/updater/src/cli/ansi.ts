/**
 * Rows to terminal text. The terminal's own 16 colours, so it looks like the terminal it runs in;
 * no colour at all under NO_COLOR or when piped.
 */

import type { Fill, Row, Run, Tone } from "../core/view/rows.ts"

const TONE: Record<Tone, string> = { text: "", muted: "90", added: "32", removed: "31", warning: "33" }
const FILL: Record<Fill, string> = { none: "", band: "48;5;236", cursor: "48;5;237", key: "48;5;238" }

function paintRun(run: Run): string {
  const codes = [
    run.tone ? TONE[run.tone] : "",
    run.fill ? FILL[run.fill] : "",
    run.bold ? "1" : "",
    run.faint ? "2" : "",
  ].filter(Boolean)
  return codes.length === 0 ? run.text : `\x1b[${codes.join(";")}m${run.text}\x1b[0m`
}

export function paint(rows: readonly Row[], color: boolean): string {
  return rows
    .map((row) => (color ? row.runs.map(paintRun).join("") : row.runs.map((r) => r.text).join("")).trimEnd())
    .map((line) => `${line}\n`)
    .join("")
}
