/** NDJSON framing shared by daemon and client. */

const encoder = new TextEncoder()

export function encodeFrame(message: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(message)}\n`)
}

/** Accumulates chunks and yields complete lines. Bounded to protect against runaway peers. */
export class LineDecoder {
  private readonly decoder = new TextDecoder()
  private pending = ""

  constructor(private readonly maxLineBytes = 16 * 1024 * 1024) {}

  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true })
    const parts = this.pending.split("\n")
    this.pending = parts.pop() ?? ""
    if (this.pending.length > this.maxLineBytes) {
      this.pending = ""
      throw new Error(`frame exceeds ${this.maxLineBytes} bytes`)
    }
    return parts.filter((line) => line.length > 0)
  }
}
