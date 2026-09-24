import { describe, expect, test } from "bun:test"
import { emptyReview, toggleRead } from "../../src/core/model/review.ts"
import { rowWidth } from "../../src/core/view/rows.ts"
import {
  cursorRow,
  headerZone,
  LARGE_DIFF,
  segmentAt,
  stopsOf,
  streamOf,
  streamScroll,
  streamWindow,
  UNVIEWED,
} from "../../src/core/view/stream.ts"

/**
 * Every file in one scroll, GitHub-style: a heading per file, viewed files folded, only what is on
 * screen ever built.
 */

const fileOf = (path: string, lines = 20) => {
  const before = Array.from({ length: lines }, (_, index) => `line ${index}`).join("\n")
  const after = before.replace("line 5", "LINE 5").replace(`line ${lines - 3}`, "CHANGED")
  return { path, before, after, additions: 2, deletions: 2 }
}

const changes = {
  source: "branch" as const,
  files: [fileOf("src/b.ts"), fileOf("src/a.ts"), fileOf("README.md")],
}
const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))
const WIDTH = 100

describe("the stream", () => {
  test("lists every file in the list's own order, each under a heading", () => {
    const stream = streamOf(changes, emptyReview(), {}, WIDTH)
    /** The tree's order — grouped by folder — so the list and the stream never disagree. */
    expect(stream.segments.map((segment) => segment.path)).toEqual(["src/b.ts", "src/a.ts", "README.md"])
    for (const [index, segment] of stream.segments.entries()) {
      const next = stream.segments[index + 1]
      if (next) expect(next.start).toBe(segment.start + segment.height)
    }
  })

  test("a viewed file is folded to its heading, and a hand-opened one is not", () => {
    const read = toggleRead(emptyReview(), "src/b.ts")
    const folded = streamOf(changes, read, {}, WIDTH).segments[0]
    expect(folded?.open).toBe(false)
    expect(folded?.height).toBe(4) // top edge, heading, bottom edge, and the gap after it
    const opened = streamOf(changes, read, { opened: new Set(["src/b.ts"]) }, WIDTH).segments[0]
    expect(opened?.open).toBe(true)
    const byHand = streamOf(changes, emptyReview(), { folded: new Set(["src/a.ts"]) }, WIDTH).segments[1]
    expect(byHand?.open).toBe(false)
  })

  test("a very large diff starts folded", () => {
    const huge = { ...fileOf("big.lock"), additions: LARGE_DIFF + 1 }
    const stream = streamOf({ source: "branch", files: [huge] }, emptyReview(), {}, WIDTH)
    expect(stream.segments[0]?.open).toBe(false)
  })

  test("draws only what fits, and every row is the column's width", () => {
    const rows = streamWindow(changes, emptyReview(), {}, WIDTH, 12)
    expect(rows).toHaveLength(12)
    for (const row of rows) expect(rowWidth(row)).toBe(WIDTH)
    /** An open card's rounded top border, then the heading itself. */
    expect(text(rows)[0]?.startsWith("╭─")).toBe(true)
    expect(text(rows)[1]).toContain("src/b.ts")
    expect(text(rows)[1]).toContain(UNVIEWED.trim())
  })

  test("the heights it measured are the rows it draws", () => {
    const stream = streamOf(changes, emptyReview(), {}, WIDTH)
    const all = streamWindow(changes, emptyReview(), { scroll: 0 }, WIDTH, stream.total)
    expect(all).toHaveLength(stream.total)
    for (const segment of stream.segments) {
      expect(all[segment.start]?.header).toBe(true)
      expect(all[segment.start]?.file).toBe(segment.path)
    }
  })

  test("halfway down a file its heading stays pinned to the top", () => {
    const stream = streamOf(changes, emptyReview(), {}, WIDTH)
    const second = stream.segments[1]
    if (!second) throw new Error("no second file")
    const rows = streamWindow(changes, emptyReview(), { scroll: second.start + 3 }, WIDTH, 8)
    expect(rows[0]?.header).toBe(true)
    expect(rows[0]?.file).toBe("src/a.ts")
  })

  test("opening a file with no scroll yet puts its heading at the top", () => {
    const stream = streamOf(changes, emptyReview(), {}, WIDTH)
    const at = streamScroll(stream, { file: "src/a.ts" }, 5)
    expect(segmentAt(stream, at)?.path).toBe("src/a.ts")
    expect(at).toBe(stream.segments[1]?.start)
  })

  test("the cursor stops at a heading, then at each line of the new file", () => {
    const stream = streamOf(changes, emptyReview(), {}, WIDTH)
    const segment = stream.segments[0]
    if (!segment) throw new Error("no file")
    const stops = stopsOf(segment, emptyReview(), {}, WIDTH)
    expect(stops[0]).toBeUndefined()
    expect(stops.slice(1).every((line) => typeof line === "number")).toBe(true)
    const line = stops[2] as number
    const row = cursorRow(stream, emptyReview(), { file: "src/b.ts", line }, WIDTH) as number
    const drawn = streamWindow(changes, emptyReview(), { scroll: 0 }, WIDTH, stream.total)
    expect(drawn[row]?.line).toBe(line)
  })
})

describe("a heading's buttons", () => {
  test("viewed on the right edge, the note just before it, folding everywhere else", () => {
    /** The last column is the card's edge; the button ends just inside it. */
    expect(headerZone(WIDTH, WIDTH - 2)).toBe("viewed")
    expect(headerZone(WIDTH, WIDTH - 1)).toBe("fold")
    expect(headerZone(WIDTH, WIDTH - UNVIEWED.length - 4)).toBe("note")
    expect(headerZone(WIDTH, 3)).toBe("fold")
    /** Too narrow for buttons: the whole heading folds. */
    expect(headerZone(30, 29)).toBe("fold")
  })
})
