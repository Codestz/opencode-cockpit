/**
 * Two versions of a file in, hunks out.
 *
 * OpenCode hands over `before` and `after` in full — never a patch — so the bay has to work out
 * what changed itself. That is a line-level longest-common-subsequence and about a hundred lines,
 * which is cheaper than a dependency: every package here has exactly one runtime dependency, and a
 * diff that lives in the repo can be tested against the files that break diffs rather than trusted.
 *
 * Line numbers are the point. A comment on "line 39" has to mean line 39 of the file on disk, or
 * the review is worse than useless to whoever reads it afterwards.
 */

export type LineKind = "context" | "add" | "remove"

export interface Line {
  kind: LineKind
  /** 1-based line number in the old file. Absent on an added line. */
  before?: number
  /** 1-based line number in the new file. Absent on a removed line. */
  after?: number
  text: string
}

export interface Hunk {
  /** Where this hunk starts in each file, 1-based, as a patch header would say. */
  beforeStart: number
  afterStart: number
  lines: Line[]
}

export interface DiffOptions {
  /** Unchanged lines kept either side of a change. */
  context?: number
}

/**
 * Splitting a file into lines is where off-by-ones come from. A trailing newline terminates the
 * last line rather than starting an empty one, and an empty file has no lines at all — not one
 * empty line, which would otherwise show up as a change when a file is created.
 */
export function toLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines
}

/**
 * The common subsequence, as a list of paired indices.
 *
 * Plain dynamic programming: a diff view is looking at one file a person can read, and the clarity
 * is worth more here than Myers' asymptotics. The guard below keeps the quadratic cost bounded.
 */
function common(before: string[], after: string[]): { a: number; b: number }[] {
  const rows = before.length
  const cols = after.length
  /**
   * One flat table rather than an array of arrays: at the cap this is ~25M entries, and a typed
   * array holds them in a quarter of the memory with no bounds-check ceremony at every read.
   */
  const stride = cols + 1
  const table = new Int32Array((rows + 1) * stride)
  const at = (a: number, b: number) => table[a * stride + b] ?? 0
  for (let a = rows - 1; a >= 0; a--) {
    for (let b = cols - 1; b >= 0; b--) {
      table[a * stride + b] =
        before[a] === after[b] ? at(a + 1, b + 1) + 1 : Math.max(at(a + 1, b), at(a, b + 1))
    }
  }

  const pairs: { a: number; b: number }[] = []
  let a = 0
  let b = 0
  while (a < rows && b < cols) {
    if (before[a] === after[b]) {
      pairs.push({ a, b })
      a++
      b++
    } else if (at(a + 1, b) >= at(a, b + 1)) {
      a++
    } else {
      b++
    }
  }
  return pairs
}

/** Past this many lines on either side the table would cost more memory than the view is worth. */
/**
 * The largest pair of files worth aligning line by line.
 *
 * The table below is `(n+1)×(m+1)` 32-bit entries, so the cost is the *product*: two 5,000-line files
 * would allocate ~100 MB inside the TUI's worker thread, which is not a price a diff view gets to
 * charge. A stretch past it is split on its unique lines first (`align`); only one with none left —
 * a wholesale rewrite — is shown as all-out-then-all-in, which is what it is.
 */
const LIMIT = 2000

/** Every line of the comparison, changed and not, in file order. */
/**
 * Everything out, then everything in — the honest answer when there is nothing to align: an empty
 * side, or two files too different to be worth matching line by line. Offsets keep the numbers
 * pointing at the real file when this is used for the middle of a trimmed comparison.
 */
function replaced(old: string[], now: string[], beforeAt: number, afterAt: number): Line[] {
  return [
    ...old.map((text, index) => ({ kind: "remove" as const, before: beforeAt + index + 1, text })),
    ...now.map((text, index) => ({ kind: "add" as const, after: afterAt + index + 1, text })),
  ]
}

/**
 * Diffs already worked out, by the text on both sides.
 *
 * The same pair is diffed more than once: for the file list's counts when git is read, then again
 * for its hunks when the stream measures and draws it. With every file in one scroll that second pass
 * is every file at once, which on a two-hundred-file review was a third of a second before the first
 * frame. Keyed on the after text and checked against the before, so a changed file is a miss.
 */
const diffed = new Map<string, { before: string; lines: Line[] }>()
const DIFFED = 400

export function diffLines(before: string, after: string): Line[] {
  const known = diffed.get(after)
  if (known && known.before === before) return known.lines
  const lines = diffUncached(before, after)
  if (diffed.size >= DIFFED) {
    const oldest = diffed.keys().next().value
    if (oldest !== undefined) diffed.delete(oldest)
  }
  diffed.set(after, { before, lines })
  return lines
}

function diffUncached(before: string, after: string): Line[] {
  const old = toLines(before)
  const now = toLines(after)
  if (old.length === 0 && now.length === 0) return []

  /** A created or deleted file has nothing to match against: all out, then all in. */
  if (old.length === 0 || now.length === 0) return replaced(old, now, 0, 0)

  /**
   * Trim the identical head and tail before aligning anything.
   *
   * This is what makes the view usable on real files. A three-thousand-line module with two edits in
   * it is identical for almost all of its length, and the table below costs the *product* of the two
   * sides — so trimming first turns a 3000×3000 alignment (~36 MB, and slow) into one over the few
   * dozen lines that actually differ. Line numbers stay honest because the trim is an offset, not a
   * reslice of the file: everything below counts from `head`.
   */
  let head = 0
  while (head < old.length && head < now.length && old[head] === now[head]) head++

  let tail = 0
  while (
    tail < old.length - head &&
    tail < now.length - head &&
    old[old.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail++
  }

  const lines: Line[] = []
  for (let index = 0; index < head; index++) {
    lines.push({ kind: "context", before: index + 1, after: index + 1, text: old[index] as string })
  }

  align(old.slice(head, old.length - tail), now.slice(head, now.length - tail), head, head, lines)

  for (let index = 0; index < tail; index++) {
    const beforeAt = old.length - tail + index
    const afterAt = now.length - tail + index
    lines.push({
      kind: "context",
      before: beforeAt + 1,
      after: afterAt + 1,
      text: old[beforeAt] as string,
    })
  }
  return lines
}

/**
 * Two stretches of the files, aligned line by line, onto `out`. `beforeAt` and `afterAt` are where
 * each stretch starts in its file, so the numbers point at the real lines.
 *
 * Small enough, it is the table above. Too large for the table, it is split first — which is what
 * makes two edits far apart a diff of two edits. The trim in `diffUncached` only removes what is
 * identical at the very ends, so an edit at line 40 and another at line 2,900 left a 2,860-line
 * middle; past the cap that was drawn as every line out and every line back in, a rewrite of a file
 * that had two lines changed.
 *
 * The split is patience diff's: lines that occur exactly once on each side are almost always the
 * same line, so the longest run of them in order is a set of fixed points, and the stretches between
 * them are aligned on their own — each far smaller, and each split again if it is still too large.
 * Only a stretch with no such line left is a genuine rewrite, and drawn as one.
 */
function align(old: string[], now: string[], beforeAt: number, afterAt: number, out: Line[]): void {
  /** Identical ends of the stretch are context, and cost nothing to take off first. */
  let head = 0
  while (head < old.length && head < now.length && old[head] === now[head]) {
    out.push({
      kind: "context",
      before: beforeAt + head + 1,
      after: afterAt + head + 1,
      text: old[head] as string,
    })
    head++
  }
  let tail = 0
  while (
    tail < old.length - head &&
    tail < now.length - head &&
    old[old.length - 1 - tail] === now[now.length - 1 - tail]
  )
    tail++
  const oldMid = head === 0 && tail === 0 ? old : old.slice(head, old.length - tail)
  const nowMid = head === 0 && tail === 0 ? now : now.slice(head, now.length - tail)
  const at = { before: beforeAt + head, after: afterAt + head }

  if (oldMid.length === 0 || nowMid.length === 0) out.push(...replaced(oldMid, nowMid, at.before, at.after))
  else if (oldMid.length <= LIMIT && nowMid.length <= LIMIT) aligned(oldMid, nowMid, at.before, at.after, out)
  else {
    const anchors = uniqueAnchors(oldMid, nowMid)
    /** Nothing in common to hold on to: a rewrite, honestly drawn as one. */
    if (anchors.length === 0) out.push(...replaced(oldMid, nowMid, at.before, at.after))
    else {
      let a = 0
      let b = 0
      for (const anchor of anchors) {
        align(oldMid.slice(a, anchor.a), nowMid.slice(b, anchor.b), at.before + a, at.after + b, out)
        out.push({
          kind: "context",
          before: at.before + anchor.a + 1,
          after: at.after + anchor.b + 1,
          text: oldMid[anchor.a] as string,
        })
        a = anchor.a + 1
        b = anchor.b + 1
      }
      align(oldMid.slice(a), nowMid.slice(b), at.before + a, at.after + b, out)
    }
  }

  for (let index = 0; index < tail; index++) {
    const a = old.length - tail + index
    const b = now.length - tail + index
    out.push({ kind: "context", before: beforeAt + a + 1, after: afterAt + b + 1, text: old[a] as string })
  }
}

/** A stretch within the table's cap, aligned by the common subsequence. */
function aligned(old: string[], now: string[], beforeAt: number, afterAt: number, out: Line[]): void {
  let a = 0
  let b = 0
  for (const pair of [...common(old, now), { a: old.length, b: now.length }]) {
    while (a < pair.a) {
      out.push({ kind: "remove", before: beforeAt + a + 1, text: old[a] as string })
      a++
    }
    while (b < pair.b) {
      out.push({ kind: "add", after: afterAt + b + 1, text: now[b] as string })
      b++
    }
    if (pair.a < old.length) {
      out.push({
        kind: "context",
        before: beforeAt + a + 1,
        after: afterAt + b + 1,
        text: old[pair.a] as string,
      })
      a++
      b++
    }
  }
}

/**
 * Lines that occur exactly once in each stretch, paired, and cut down to the longest run that is in
 * order on both sides — patience sorting, `n log n`. These are the fixed points the stretch is split on.
 */
function uniqueAnchors(old: readonly string[], now: readonly string[]): { a: number; b: number }[] {
  const once = (lines: readonly string[]) => {
    const seen = new Map<string, number>()
    lines.forEach((line, index) => {
      seen.set(line, seen.has(line) ? -1 : index)
    })
    return seen
  }
  const inOld = once(old)
  const inNow = once(now)
  const pairs: { a: number; b: number }[] = []
  for (const [line, a] of inOld) {
    const b = inNow.get(line)
    if (a >= 0 && b !== undefined && b >= 0) pairs.push({ a, b })
  }
  pairs.sort((x, y) => x.a - y.a)

  /** Longest increasing run of `b`: piles of their smallest tops, each card linked to the one before. */
  const tops: number[] = []
  const previous = new Int32Array(pairs.length).fill(-1)
  for (let index = 0; index < pairs.length; index++) {
    const b = (pairs[index] as { b: number }).b
    let low = 0
    let high = tops.length
    while (low < high) {
      const mid = (low + high) >> 1
      if ((pairs[tops[mid] as number] as { b: number }).b < b) low = mid + 1
      else high = mid
    }
    if (low > 0) previous[index] = tops[low - 1] as number
    tops[low] = index
  }
  const run: { a: number; b: number }[] = []
  for (let at = tops.at(-1) ?? -1; at >= 0; at = previous[at] as number)
    run.push(pairs[at] as { a: number; b: number })
  return run.reverse()
}

/**
 * The changed parts, with a few unchanged lines either side for orientation, and the long runs of
 * untouched file left out — which is the whole reason a diff is readable at all.
 */
export function toHunks(before: string, after: string, options: DiffOptions = {}): Hunk[] {
  const context = Math.max(0, options.context ?? 3)
  const lines = diffLines(before, after)
  const changed = lines.map((line) => line.kind !== "context")
  if (!changed.includes(true)) return []

  /** Which lines to keep: every change, plus `context` either side of one. */
  const keep = lines.map((_, index) =>
    changed.slice(Math.max(0, index - context), index + context + 1).includes(true),
  )

  const hunks: Hunk[] = []
  let current: Hunk | undefined
  for (const [index, line] of lines.entries()) {
    if (!keep[index]) {
      current = undefined
      continue
    }
    if (!current) {
      current = {
        // A hunk that opens on an added line has no old line of its own; it starts where the old
        // file had got to, which is what a patch header reports.
        beforeStart: line.before ?? nextNumber(lines, index, "before"),
        afterStart: line.after ?? nextNumber(lines, index, "after"),
        lines: [],
      }
      hunks.push(current)
    }
    current.lines.push(line)
  }
  return hunks
}

/** The first line number of the given side at or after `from`, defaulting to 1 for a new file. */
function nextNumber(lines: Line[], from: number, side: "before" | "after"): number {
  for (let index = from; index < lines.length; index++) {
    const number = lines[index]?.[side]
    if (number !== undefined) return number
  }
  for (let index = from - 1; index >= 0; index--) {
    const number = lines[index]?.[side]
    if (number !== undefined) return number + 1
  }
  return 1
}

/** `+12 −3`, counted from the lines themselves rather than trusted from elsewhere. */
export function countChanges(lines: readonly Line[]): { additions: number; deletions: number } {
  return {
    additions: lines.filter((line) => line.kind === "add").length,
    deletions: lines.filter((line) => line.kind === "remove").length,
  }
}
