import type { ScreenResult, ScreenRun } from "@opencode-cockpit/protocol/shell"
import type { IBufferCell } from "@xterm/headless"
import { Terminal } from "@xterm/headless"
import { paletteColor, rgbColor } from "./palette.ts"

/** Full VT emulation of a shell's output: what a human would see right now (ADR 0003). */
export class Screen {
  private readonly term: Terminal

  constructor(cols: number, rows: number, scrollback = 2000) {
    this.term = new Terminal({ cols, rows, scrollback, allowProposedApi: true })
  }

  write(chunk: Uint8Array): void {
    this.term.write(chunk)
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  reset(): void {
    this.term.reset()
  }

  /** Waits until every pending write has been parsed, then renders the viewport. */
  async snapshot(): Promise<ScreenResult> {
    await new Promise<void>((resolve) => this.term.write("", resolve))
    const buffer = this.term.buffer.active
    const rows: string[] = []
    const styled: ScreenRun[][] = []
    for (let y = 0; y < this.term.rows; y++) {
      const line = buffer.getLine(buffer.baseY + y)
      rows.push(line?.translateToString(true) ?? "")
      styled.push(line ? styleRuns(line, this.term.cols) : [])
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") {
      rows.pop()
      styled.pop()
    }
    return {
      text: rows.join("\n"),
      cols: this.term.cols,
      rows: this.term.rows,
      cursor: { x: buffer.cursorX, y: buffer.cursorY },
      styled,
    }
  }

  dispose(): void {
    this.term.dispose()
  }
}

interface StyledLine {
  getCell(x: number, cell?: IBufferCell): IBufferCell | undefined
}

/** Groups a row's cells into runs of identical style, trimming the trailing blank. */
function styleRuns(line: StyledLine, cols: number): ScreenRun[] {
  const runs: ScreenRun[] = []
  let current: ScreenRun | undefined
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    const chars = cell.getChars() || " "
    const style = cellStyle(cell)
    if (current && sameStyle(current, style)) current.text += chars
    else {
      current = { ...style, text: chars }
      runs.push(current)
    }
  }
  // Drop trailing spaces so a mostly empty row costs nothing to send or paint.
  while (runs.length > 0) {
    const last = runs[runs.length - 1] as ScreenRun
    last.text = last.text.replace(/\s+$/, "")
    if (last.text.length > 0) break
    runs.pop()
  }
  return runs
}

function cellStyle(cell: IBufferCell): Omit<ScreenRun, "text"> {
  const inverse = cell.isInverse() !== 0
  const fg = colorOf(cell, inverse ? "bg" : "fg")
  const bg = colorOf(cell, inverse ? "fg" : "bg")
  const style: Omit<ScreenRun, "text"> = {}
  if (fg) style.fg = fg
  if (bg) style.bg = bg
  if (cell.isBold()) style.bold = true
  if (cell.isDim()) style.dim = true
  if (cell.isItalic()) style.italic = true
  if (cell.isUnderline()) style.underline = true
  return style
}

function colorOf(cell: IBufferCell, which: "fg" | "bg"): string | undefined {
  const isDefault = which === "fg" ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return undefined
  const rgb = which === "fg" ? cell.isFgRGB() : cell.isBgRGB()
  const value = which === "fg" ? cell.getFgColor() : cell.getBgColor()
  return rgb ? rgbColor(value) : paletteColor(value)
}

function sameStyle(a: ScreenRun, b: Omit<ScreenRun, "text">): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline
  )
}
