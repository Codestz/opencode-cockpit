/**
 * Streaming terminal-output normalizer (ADR 0003).
 *
 * Turns a PTY byte stream into committed plain-text lines, applying the parts of terminal
 * semantics that matter for a single line: carriage return and backspace overwrite, tabs, erase
 * in line, and horizontal cursor moves. Escape sequences are consumed and dropped. Anything that
 * moves between lines (cursor up, scroll regions) is out of scope; the screen view handles those.
 */

const ESC = 0x1b
const BEL = 0x07
const TAB_WIDTH = 8

enum State {
  Ground,
  Escape,
  EscapeIntermediate,
  Csi,
  Osc,
  OscEscape,
}

export interface NormalizerOptions {
  /** Force a commit when a line grows past this many characters. */
  maxLineLength?: number
}

export class OutputNormalizer {
  private readonly decoder = new TextDecoder()
  private readonly maxLineLength: number
  private state = State.Ground
  private csiParams = ""
  private cells: string[] = []
  private col = 0

  constructor(
    private readonly commit: (text: string) => void,
    options: NormalizerOptions = {},
  ) {
    this.maxLineLength = options.maxLineLength ?? 10_000
  }

  /** Text of the line currently being written (not yet terminated by a newline). */
  get partial(): string {
    return this.render()
  }

  push(chunk: Uint8Array | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true })
    for (const char of text) this.step(char)
  }

  /** Commit the partial line, if any. Call when the stream ends. */
  flush(): void {
    const tail = this.render()
    if (tail.length > 0) this.commit(tail)
    this.cells = []
    this.col = 0
  }

  private step(char: string): void {
    const code = char.codePointAt(0) ?? 0
    switch (this.state) {
      case State.Ground:
        this.ground(char, code)
        return
      case State.Escape:
        if (code === 0x5b) {
          this.state = State.Csi
          this.csiParams = ""
        } else if (code === 0x5d) {
          this.state = State.Osc
        } else if (code >= 0x20 && code <= 0x2f) {
          this.state = State.EscapeIntermediate
        } else {
          this.state = State.Ground
        }
        return
      case State.EscapeIntermediate:
        if (code >= 0x30 && code <= 0x7e) this.state = State.Ground
        return
      case State.Csi:
        if (code >= 0x40 && code <= 0x7e) {
          this.csi(char, this.csiParams)
          this.state = State.Ground
        } else {
          this.csiParams += char
        }
        return
      case State.Osc:
        if (code === BEL) this.state = State.Ground
        else if (code === ESC) this.state = State.OscEscape
        return
      case State.OscEscape:
        this.state = code === 0x5c ? State.Ground : State.Osc
        return
    }
  }

  private ground(char: string, code: number): void {
    if (code === ESC) {
      this.state = State.Escape
      return
    }
    if (char === "\n") {
      this.commit(this.render())
      this.cells = []
      this.col = 0
      return
    }
    if (char === "\r") {
      this.col = 0
      return
    }
    if (char === "\b") {
      this.col = Math.max(0, this.col - 1)
      return
    }
    if (char === "\t") {
      const next = (Math.floor(this.col / TAB_WIDTH) + 1) * TAB_WIDTH
      while (this.col < next) this.put(" ")
      return
    }
    if (code < 0x20 || code === 0x7f) return
    this.put(char)
  }

  private csi(final: string, raw: string): void {
    const params = raw.replace(/^[?>=!]/, "")
    const first = Number.parseInt(params.split(";")[0] ?? "", 10)
    const n = Number.isNaN(first) ? undefined : first
    switch (final) {
      case "K": // erase in line
        if (n === undefined || n === 0) this.cells.length = Math.min(this.cells.length, this.col)
        else if (n === 1) for (let i = 0; i <= this.col && i < this.cells.length; i++) this.cells[i] = " "
        else if (n === 2) this.cells = []
        return
      case "G": // cursor horizontal absolute (1-based)
        this.col = Math.max(0, (n ?? 1) - 1)
        return
      case "C": // cursor forward
        this.col += Math.max(1, n ?? 1)
        return
      case "D": // cursor back
        this.col = Math.max(0, this.col - Math.max(1, n ?? 1))
        return
      case "J": // erase display: the current line is all this view can clear
        if (n === 2 || n === 3) {
          this.cells = []
          this.col = 0
        }
        return
      default:
        return // colours (m) and everything else carry no line text
    }
  }

  private put(char: string): void {
    while (this.cells.length < this.col) this.cells.push(" ")
    this.cells[this.col] = char
    this.col++
    if (this.cells.length >= this.maxLineLength) {
      this.commit(this.render())
      this.cells = []
      this.col = 0
    }
  }

  private render(): string {
    return this.cells.join("").trimEnd()
  }
}
