import { describe, expect, test } from "bun:test"
import { LineLog } from "../src/modules/shell/output/line-log.ts"
import { OutputNormalizer } from "../src/modules/shell/output/normalizer.ts"
import { RawRing } from "../src/modules/shell/output/raw-ring.ts"
import { Screen } from "../src/modules/shell/output/screen.ts"

function normalize(...chunks: string[]) {
  const lines: string[] = []
  const n = new OutputNormalizer((l) => lines.push(l))
  for (const c of chunks) n.push(new TextEncoder().encode(c))
  return { lines, partial: n.partial, n }
}

describe("OutputNormalizer", () => {
  test("carriage-return redraws collapse to the final frame", () => {
    expect(normalize("\r1\r2\r3\n").lines).toEqual(["3"])
    expect(normalize("\r33%", "\r66%", "\r99%\r\n").lines).toEqual(["99%"])
  })

  test("strips colours, OSC titles and charset escapes", () => {
    expect(normalize("\x1b[1;31mred\x1b[0m \x1b]0;title\x07ok\x1b(B!\n").lines).toEqual(["red ok!"])
    expect(normalize("\x1b]8;;http://x\x1b\\link\n").lines).toEqual(["link"])
  })

  test("erase in line after carriage return clears stale text", () => {
    expect(normalize("downloading 100%\r\x1b[Kdone\n").lines).toEqual(["done"])
    expect(normalize("abcdef\r\x1b[2Kxy\n").lines).toEqual(["xy"])
  })

  test("backspace, tabs and cursor moves", () => {
    expect(normalize("abc\b\bX\n").lines).toEqual(["aXc"])
    expect(normalize("a\tb\n").lines).toEqual(["a       b"])
    expect(normalize("hello\x1b[3DY\n").lines).toEqual(["heYlo"])
    expect(normalize("x\x1b[5Gy\n").lines).toEqual(["x   y"])
  })

  test("escape sequences split across chunks", () => {
    expect(normalize("a\x1b[3", "1mb\x1b", "[0mc\n").lines).toEqual(["abc"])
  })

  test("multi-byte UTF-8 split across chunks", () => {
    const bytes = new TextEncoder().encode("héllo ✓\n")
    const lines: string[] = []
    const n = new OutputNormalizer((l) => lines.push(l))
    n.push(bytes.subarray(0, 2))
    n.push(bytes.subarray(2, 9))
    n.push(bytes.subarray(9))
    expect(lines).toEqual(["héllo ✓"])
  })

  test("partial line is visible and flush commits it", () => {
    const r = normalize("Password: ")
    expect(r.lines).toEqual([])
    expect(r.partial).toBe("Password:")
    r.n.flush()
    expect(r.lines).toEqual(["Password:"])
  })

  test("overlong lines are force-committed", () => {
    const lines: string[] = []
    const n = new OutputNormalizer((l) => lines.push(l), { maxLineLength: 4 })
    n.push("abcdefghij\n")
    expect(lines).toEqual(["abcd", "efgh", "ij"])
  })
})

describe("LineLog", () => {
  const fill = (log: LineLog, count: number) => {
    for (let i = 1; i <= count; i++) log.append(`line ${i}`)
  }

  test("tail by default, cursor continues", () => {
    const log = new LineLog()
    fill(log, 10)
    const page = log.read({ tail: 3, limit: 100 })
    expect(page.lines.map((l) => l.n)).toEqual([8, 9, 10])
    expect(page.nextCursor).toBe(10)
    log.append("line 11")
    expect(log.read({ after: page.nextCursor, tail: 3, limit: 100 }).lines).toEqual([
      { n: 11, text: "line 11" },
    ])
  })

  test("limit pages and reports hasMore", () => {
    const log = new LineLog()
    fill(log, 10)
    const page = log.read({ after: 0, tail: 100, limit: 4 })
    expect(page.lines.map((l) => l.n)).toEqual([1, 2, 3, 4])
    expect(page.hasMore).toBe(true)
    expect(log.read({ after: page.nextCursor, tail: 100, limit: 100 }).lines[0]?.n).toBe(5)
  })

  test("grep filters but the cursor still advances past scanned lines", () => {
    const log = new LineLog()
    fill(log, 20)
    const page = log.read({ after: 0, tail: 100, limit: 100, grep: /line 1\d/ })
    expect(page.lines.map((l) => l.n)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(page.nextCursor).toBe(20)
  })

  test("eviction keeps numbering and flags truncation", () => {
    const log = new LineLog(30) // each "line N" ≈ 7-8 chars
    fill(log, 10)
    expect(log.firstLine).toBeGreaterThan(1)
    expect(log.lastLine).toBe(10)
    const page = log.read({ after: 0, tail: 100, limit: 100 })
    expect(page.truncated).toBe(true)
    expect(page.lines[0]?.n).toBe(log.firstLine)
    expect(log.read({ after: 9, tail: 100, limit: 100 }).truncated).toBe(false)
  })

  test("empty log", () => {
    const page = new LineLog().read({ tail: 10, limit: 10 })
    expect(page).toMatchObject({ lines: [], lastLine: 0, nextCursor: 0, truncated: false })
  })
})

describe("RawRing", () => {
  test("replays from offsets and evicts whole chunks", () => {
    const ring = new RawRing(6)
    const enc = (s: string) => new TextEncoder().encode(s)
    ring.append(enc("abc"))
    ring.append(enc("def"))
    ring.append(enc("gh"))
    expect(ring.end).toBe(8)
    const all = ring.since(0)
    expect(all.offset).toBe(3)
    expect(new TextDecoder().decode(all.bytes)).toBe("defgh")
    expect(new TextDecoder().decode(ring.since(7).bytes)).toBe("h")
  })
})

describe("Screen", () => {
  test("renders what a human sees, including cursor-up redraws", async () => {
    const screen = new Screen(40, 5)
    screen.write(new TextEncoder().encode("step 1\r\nstep 2\r\n\x1b[1A\x1b[2Kdone 2\r\n"))
    const snap = await screen.snapshot()
    expect(snap.text).toBe("step 1\ndone 2")
    screen.dispose()
  })
})
