/**
 * Drawing a statusline to a real terminal, outside OpenCode.
 *
 * The TUI paints runs through OpenTUI against the running theme; here the same runs are written as
 * ANSI so a design can be looked at without restarting anything. The colours approximate a dark
 * theme — close enough to judge a design, never the authority on one.
 */

import type { Run, Tone } from "../core/types.ts"

const TONE_RGB: Record<Tone, [number, number, number]> = {
  text: [232, 237, 242],
  muted: [138, 148, 160],
  accent: [57, 211, 83],
  success: [57, 211, 83],
  warning: [232, 185, 35],
  error: [248, 81, 73],
  info: [110, 168, 254],
  background: [11, 13, 16],
  panel: [38, 43, 51],
  border: [62, 70, 80],
}

function hexRgb(hex: string): [number, number, number] | undefined {
  const value = hex.replace("#", "")
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value
  if (full.length !== 6) return undefined
  const n = Number.parseInt(full, 16)
  return Number.isNaN(n) ? undefined : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const ESC = String.fromCharCode(27)
const fg = ([r, g, b]: [number, number, number]) => `${ESC}[38;2;${r};${g};${b}m`
const bg = ([r, g, b]: [number, number, number]) => `${ESC}[48;2;${r};${g};${b}m`
const RESET = `${ESC}[0m`

/** Dim is rendered as a darker colour rather than the SGR attribute, which terminals disagree on. */
function darken([r, g, b]: [number, number, number]): [number, number, number] {
  return [Math.round(r * 0.62), Math.round(g * 0.62), Math.round(b * 0.62)]
}

export function paint(run: Run): string {
  const own = run.color ? hexRgb(run.color) : undefined
  let colour = own ?? TONE_RGB[run.tone ?? "text"]
  if (run.dim) colour = darken(colour)
  const back = run.bg ? hexRgb(run.bg) : run.bgTone ? TONE_RGB[run.bgTone] : undefined
  return [back ? bg(back) : "", fg(colour), run.bold ? `${ESC}[1m` : "", run.text, RESET].join("")
}

export function paintRuns(runs: readonly Run[]): string {
  return runs.map(paint).join("")
}
