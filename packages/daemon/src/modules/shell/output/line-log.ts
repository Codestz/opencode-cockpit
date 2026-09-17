import type { LogLine } from "@opencode-cockpit/protocol/shell"

export interface ReadQuery {
  after?: number
  tail: number
  limit: number
  grep?: RegExp
}

export interface ReadPage {
  lines: LogLine[]
  firstLine: number
  lastLine: number
  nextCursor: number
  truncated: boolean
  hasMore: boolean
}

/**
 * Committed lines with monotonic numbering (1-based) and a character budget.
 * Eviction drops the oldest lines and advances `firstLine`; numbers are never reused, so cursors
 * held by clients stay meaningful after eviction.
 */
export class LineLog {
  private lines: string[] = []
  private head = 0
  private chars = 0
  private first = 1

  constructor(private readonly maxChars = 4_000_000) {}

  /** Number of the oldest retained line (equals `lastLine + 1` when empty). */
  get firstLine(): number {
    return this.first
  }

  /** Number of the newest line, or `firstLine - 1` when empty. */
  get lastLine(): number {
    return this.first + (this.lines.length - this.head) - 1
  }

  append(text: string): LogLine {
    this.lines.push(text)
    this.chars += text.length + 1
    const line = { n: this.lastLine, text }
    this.evict()
    return line
  }

  get(n: number): string | undefined {
    if (n < this.first || n > this.lastLine) return undefined
    return this.lines[this.head + (n - this.first)]
  }

  read(query: ReadQuery): ReadPage {
    const last = this.lastLine
    const requestedStart = query.after !== undefined ? query.after + 1 : Math.max(1, last - query.tail + 1)
    const start = Math.max(requestedStart, this.first)
    const truncated = requestedStart < this.first && last >= requestedStart

    const out: LogLine[] = []
    let n = start
    for (; n <= last && out.length < query.limit; n++) {
      const text = this.lines[this.head + (n - this.first)] as string
      if (query.grep && !query.grep.test(text)) continue
      out.push({ n, text })
    }
    const scannedTo = n - 1
    return {
      lines: out,
      firstLine: this.first,
      lastLine: last,
      nextCursor: Math.max(scannedTo, start - 1),
      truncated,
      hasMore: scannedTo < last,
    }
  }

  private evict(): void {
    while (this.chars > this.maxChars && this.head < this.lines.length - 1) {
      const dropped = this.lines[this.head] as string
      this.chars -= dropped.length + 1
      this.head++
      this.first++
    }
    // Compact occasionally so the backing array does not grow without bound.
    if (this.head > 4096 && this.head * 2 > this.lines.length) {
      this.lines = this.lines.slice(this.head)
      this.head = 0
    }
  }
}
