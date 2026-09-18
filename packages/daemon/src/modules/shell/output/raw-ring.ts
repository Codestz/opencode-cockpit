/**
 * Bounded store of raw PTY bytes addressed by absolute offset, for replaying output to UIs that
 * attach after the fact. Evicts whole chunks from the front.
 */
export class RawRing {
  private chunks: Uint8Array[] = []
  private size = 0
  private start = 0

  constructor(private readonly maxBytes = 1_000_000) {}

  /** Absolute offset one past the last byte ever written. */
  get end(): number {
    return this.start + this.size
  }

  append(chunk: Uint8Array): number {
    const offset = this.end
    this.chunks.push(chunk)
    this.size += chunk.byteLength
    while (this.size > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift() as Uint8Array
      this.size -= dropped.byteLength
      this.start += dropped.byteLength
    }
    return offset
  }

  /**
   * Bytes from `offset` to the end, clamped to what is retained. An offset past the end asks for
   * nothing but future output — a UI that only wants what comes next — and must not be an error.
   */
  since(offset = 0): { offset: number; bytes: Uint8Array } {
    const from = Math.min(Math.max(offset, this.start), this.end)
    const out = new Uint8Array(this.end - from)
    let cursor = this.start
    let written = 0
    for (const chunk of this.chunks) {
      const chunkEnd = cursor + chunk.byteLength
      if (chunkEnd > from) {
        const slice = chunk.subarray(Math.max(0, from - cursor))
        out.set(slice, written)
        written += slice.byteLength
      }
      cursor = chunkEnd
    }
    return { offset: from, bytes: out }
  }
}
