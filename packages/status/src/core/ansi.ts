import type { Run, Tone } from "./segments.ts"

/**
 * Turning a script's coloured output into styled runs.
 *
 * Statusline scripts written for Claude Code colour themselves with SGR escapes — true-colour
 * `\\e[38;2;R;G;Bm` in the good ones. Stripping those and drawing the text grey throws away most
 * of what the author wrote; parsing them means a script someone already tuned looks the same here
 * as it does there, without a line of it changing.
 *
 * Only SGR is understood. Cursor movement and the rest are dropped, because a statusline that
 * moves the cursor is not a statusline.
 */

const SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, "g")

/** The 16 basic colours, mapped to tones so they follow the user's theme rather than fighting it. */
const BASIC_TONE: Record<number, Tone> = {
  30: "text",
  31: "error",
  32: "success",
  33: "warning",
  34: "info",
  35: "accent",
  36: "info",
  37: "text",
  90: "muted",
  91: "error",
  92: "success",
  93: "warning",
  94: "info",
  95: "accent",
  96: "info",
  97: "text",
}

interface Style {
  color?: string
  tone?: Tone
  bg?: string
  bold?: boolean
  dim?: boolean
}

const CLEAR: Style = {}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`
}

/**
 * The xterm 256-colour cube, so `\\e[38;5;208m` is the orange the author meant rather than a
 * guess. 0-15 are the basics, 16-231 a 6×6×6 cube, 232-255 a grey ramp.
 */
const CUBE = [0, 95, 135, 175, 215, 255]
function from256(n: number): string | undefined {
  if (n < 16) return undefined // a basic colour: let the tone mapping handle it
  if (n < 232) {
    const index = n - 16
    return hex(
      CUBE[Math.floor(index / 36) % 6] as number,
      CUBE[Math.floor(index / 6) % 6] as number,
      CUBE[index % 6] as number,
    )
  }
  const grey = 8 + (n - 232) * 10
  return hex(grey, grey, grey)
}

/** Applies one escape's parameters to the running style. */
function apply(style: Style, params: number[]): Style {
  let next: Style = { ...style }
  for (let i = 0; i < params.length; i++) {
    const code = params[i] as number
    if (code === 0) {
      next = { ...CLEAR }
    } else if (code === 1) {
      next.bold = true
    } else if (code === 2) {
      next.dim = true
    } else if (code === 22) {
      next.bold = false
      next.dim = false
    } else if (code === 39) {
      next.color = undefined
      next.tone = undefined
    } else if (code === 49) {
      next.bg = undefined
    } else if (code === 38 || code === 48) {
      // Extended colour: 5;n for the 256 palette, 2;r;g;b for true colour.
      const mode = params[i + 1]
      if (mode === 5) {
        const value = params[i + 2] as number
        const colour = from256(value)
        if (code === 38) {
          next.color = colour
          next.tone = colour ? undefined : BASIC_TONE[value < 8 ? value + 30 : value + 82]
        } else if (colour) {
          next.bg = colour
        }
        i += 2
      } else if (mode === 2) {
        const colour = hex(params[i + 2] as number, params[i + 3] as number, params[i + 4] as number)
        if (code === 38) {
          next.color = colour
          next.tone = undefined
        } else {
          next.bg = colour
        }
        i += 4
      }
    } else if (BASIC_TONE[code]) {
      next.tone = BASIC_TONE[code]
      next.color = undefined
    }
  }
  return next
}

/**
 * Parses one line of a script's output into runs. Text with no escapes comes back as a single
 * muted run, which is what a plain script should look like.
 */
export function parseAnsi(line: string): Run[] {
  const runs: Run[] = []
  let style: Style = { ...CLEAR }
  let at = 0

  SGR.lastIndex = 0
  for (let match = SGR.exec(line); match !== null; match = SGR.exec(line)) {
    const text = line.slice(at, match.index)
    if (text) runs.push(toRun(text, style))
    const body = match[1] ?? ""
    style = apply(style, body === "" ? [0] : body.split(";").map((part) => Number.parseInt(part, 10) || 0))
    at = match.index + match[0].length
  }
  const rest = line.slice(at)
  if (rest) runs.push(toRun(rest, style))
  // Anything left over (a line of pure escapes) is nothing to draw.
  return runs
}

function toRun(text: string, style: Style): Run {
  const run: Run = { text }
  if (style.color) run.color = style.color
  else run.tone = style.tone ?? "muted"
  if (style.bg) run.bg = style.bg
  if (style.bold) run.bold = true
  if (style.dim) run.dim = true
  return run
}

/** Every line of a script's output, parsed. Claude Code statuslines may print several rows. */
export function parseAnsiLines(stdout: string): Run[][] {
  return stdout
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => parseAnsi(line))
    .filter((runs) => runs.length > 0)
}
