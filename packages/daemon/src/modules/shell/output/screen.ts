import type { ScreenResult } from "@opencode-cockpit/protocol/shell"
import { Terminal } from "@xterm/headless"

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
    for (let y = 0; y < this.term.rows; y++) {
      rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "")
    }
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop()
    return {
      text: rows.join("\n"),
      cols: this.term.cols,
      rows: this.term.rows,
      cursor: { x: buffer.cursorX, y: buffer.cursorY },
    }
  }

  dispose(): void {
    this.term.dispose()
  }
}
