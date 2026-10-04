import { describe, expect, test } from "bun:test"
import { budgetFile, parseBudget } from "../src/core/budget.ts"
import { asSegmentConfig, PRESETS, resolveLines, SIDEBAR_SEGMENTS } from "../src/core/config.ts"
import type { SessionSnapshot, StatusContext } from "../src/core/context.ts"
import { branchDiffCommand, wantsBranchDiff, wantsDiff } from "../src/core/diff.ts"
import { FIXTURES } from "../src/core/fixtures.ts"
import { fitColumn } from "../src/core/render.ts"
import { buildSegments, findSegment, type Segment, segmentText, segmentWidth } from "../src/core/segments.ts"

/**
 * The sidebar's table — the `sidebar` preset, and the default since 0.9. Its rows were the
 * `sidebar-budget` example's, promoted to built-ins so the default needs no module. Its whole point
 * is that a column of rows lines up and says nothing it has no figure for, so both are asserted.
 */

const session = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: "ses_1",
  status: "idle",
  cost: 0,
  priced: true,
  messages: 2,
  startedAt: 0,
  model: { providerID: "p", modelID: "m", contextLimit: 200_000 },
  tokens: { input: 24_000, output: 16_000, reasoning: 0, cache: { read: 40_000, write: 0 } },
  diff: { files: 0, additions: 0, deletions: 0 },
  todo: { total: 0, completed: 0 },
  ...over,
})

const ctx = (over: Partial<StatusContext> = {}): StatusContext => ({
  now: 60_000,
  directory: "/w/app",
  worktree: "/w/app",
  home: "/home/u",
  defaultBranch: "main",
  version: "0.9.0",
  lsp: [],
  mcp: [],
  commands: {},
  width: 34,
  session: session(),
  ...over,
})

const draw = (type: string, context: StatusContext, config: Record<string, unknown> = {}) =>
  buildSegments(context, [{ type, ...config }], { icons: false })[0]
const text = (segment: Segment | undefined) => (segment ? segmentText(segment) : undefined)

/** The whole preset, as the sidebar draws it. */
const table = (context: StatusContext) =>
  fitColumn(
    buildSegments(context, SIDEBAR_SEGMENTS.map(asSegmentConfig)),
    context.width,
    PRESETS.sidebar?.maxRows ?? 8,
  ).segments.map((segment) => segmentText(segment))

describe("the sidebar preset", () => {
  test("is the default: writing nothing draws the table in the sidebar", () => {
    const [line] = resolveLines({})
    expect(line?.surface).toBe("sidebar")
    expect(line?.segments).toEqual(SIDEBAR_SEGMENTS)
  })

  test("every name in it is a built-in, so it needs no module", () => {
    for (const entry of SIDEBAR_SEGMENTS) expect(findSegment(asSegmentConfig(entry).type)).toBeDefined()
  })

  test("a working session, no proxy: heading, bar, tokens by where they went, one hairline, the branch", () => {
    expect(table(ctx({ diff: { files: 3, additions: 42, deletions: 7 } }))).toEqual([
      "Status",
      "█".repeat(5) + "█".repeat(11),
      "tokens 80k · 40%",
      "in     24k · 30%",
      "out    16k · 20%",
      "cache  40k · 50%",
      "─".repeat(14),
      "git    3f +42 -7",
    ])
  })

  test("with a proxy's budget, the budget is a group of its own", () => {
    const rows = table(
      ctx({ budget: { spent: 26.24, cap: 200 }, diff: { files: 3, additions: 42, deletions: 7 } }),
    )
    expect(rows.slice(-5)).toEqual([
      "─".repeat(14),
      "spend  $26.24",
      "avail  $173.76 · 87% left",
      "─".repeat(14),
      "git    3f +42 -7",
    ])
  })

  test("a hairline left with nothing under it goes: a budget and no branch", () => {
    const rows = table(ctx({ budget: { spent: 26.24, cap: 200 } }))
    expect(rows.at(-1)).toBe("avail  $173.76 · 87% left")
    expect(rows.filter((row) => row.startsWith("─"))).toHaveLength(1)
  })

  /** Every row of a busy session with a budget, uncommitted work and a broken server fits under the cap. */
  test("the cap holds every row it has, so none is dropped on a full session", () => {
    const full = ctx({
      ...FIXTURES.full.ctx,
      width: 34,
      budget: { spent: 26.24, cap: 200 },
      diff: { files: 3, additions: 42, deletions: 7 },
      mcp: [{ name: "github", status: "failed" }],
      session: {
        ...(FIXTURES.full.ctx.session as SessionSnapshot),
        status: "retry",
        retry: { attempt: 2, message: "", next: 6_000 },
      },
    })
    const built = buildSegments(full, SIDEBAR_SEGMENTS.map(asSegmentConfig))
    const fitted = fitColumn(built, 34, PRESETS.sidebar?.maxRows ?? 8)
    expect(fitted.dropped).toBe(0)
    expect(fitted.segments.map((segment) => segment.id)).toContain("diagnostics")
  })

  test("before the first reply: the heading and what is uncommitted, and no hairline with nothing under it", () => {
    const fresh = ctx({ ...FIXTURES.fresh.ctx, width: 34, diff: { files: 5, additions: 312, deletions: 48 } })
    expect(table(fresh)).toEqual(["Status", "─".repeat(14), "git    5f +312 -48"])
    expect(table(ctx({ ...FIXTURES.fresh.ctx, width: 34 }))).toEqual(["Status"])
  })

  test("every row fits a 24-column sidebar, a word given up before a figure", () => {
    const narrow = ctx({
      width: 24,
      budget: { spent: 26.24, cap: 200 },
      diff: { files: 28, additions: 1_840, deletions: 620 },
    })
    for (const row of table(narrow)) expect(row.length).toBeLessThanOrEqual(24)
    expect(table(narrow)).toContain("avail  $173.76 · 87%")
    expect(table(narrow)).toContain("git    28f +1.8k -620")
  })
})

describe("the table's rows", () => {
  test("every labelled row starts with the same seven-column gutter, a space past the longest label", () => {
    for (const type of ["in", "out", "cache", "spend", "avail", "git"]) {
      const drawn = draw(
        type,
        ctx({ budget: { spent: 1, cap: 10 }, diff: { files: 1, additions: 1, deletions: 1 } }),
      )
      expect(drawn?.runs[0]?.text, type).toHaveLength(7)
    }
    expect(draw("tokens", ctx(), { style: "row" })?.runs[0]?.text).toBe("tokens ")
  })

  test("the token rows are shares of the window, and they add up to it", () => {
    const shares = ["in", "out", "cache", "write"].map((type) => {
      const drawn = draw(type, ctx())
      return drawn ? Number(/(\d+)%$/.exec(segmentText(drawn))?.[1] ?? 0) : 0
    })
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
  })

  /** `write 0 · 0%` on a session with no cache writes said nothing, in a row of its own. */
  test("a row whose figure is zero is not drawn", () => {
    expect(draw("write", ctx())).toBeUndefined()
  })

  /** The figure lives on the tokens row below; printing it twice is what the bar is spared. */
  test("the bar is the full width of solid cells and nothing else", () => {
    expect(text(draw("context", ctx(), { style: "solid", width: 16 }))).toBe("█".repeat(16))
  })

  /** Without a proxy writing the file there is no budget, and a made-up one would be worse. */
  test("the budget rows stay silent when nothing reports a spend", () => {
    expect(draw("spend", ctx())).toBeUndefined()
    expect(draw("avail", ctx())).toBeUndefined()
  })

  test("the budget is calm until it is a level to watch", () => {
    expect(draw("spend", ctx({ budget: { spent: 26, cap: 200 } }))?.runs[1]?.tone).toBe("text")
    expect(draw("spend", ctx({ budget: { spent: 190, cap: 200 } }))?.runs[1]?.tone).toBe("error")
  })

  /** The word is the label: no coloured square beside it, and the figures are not categories. */
  test("colour is a level, never a label", () => {
    for (const type of ["in", "out", "cache"]) {
      const drawn = draw(type, ctx())
      for (const run of drawn?.runs ?? []) expect(["text", "muted"]).toContain(run.tone)
    }
  })

  test("git is what is uncommitted, and silent until git says", () => {
    expect(draw("git", ctx({ diff: undefined }))).toBeUndefined()
    expect(draw("git", ctx({ diff: { files: 0, additions: 0, deletions: 0 } }))).toBeUndefined()
    expect(text(draw("git", ctx({ diff: { files: 2, additions: 9, deletions: 1 } })))).toBe("git    2f +9 -1")
  })

  test("against the branch, git is the branch against where it forked", () => {
    const branched = ctx({ branchDiff: { files: 2, additions: 9, deletions: 1 }, defaultBranch: "dev" })
    expect(text(draw("git", branched, { against: "branch" }))).toBe("git    2f +9 -1 vs dev")
  })

  test("the heading says Status unless told otherwise", () => {
    expect(draw("title", ctx())?.runs[0]).toMatchObject({ text: "Status", bold: true })
    expect(text(draw("title", ctx(), { text: "Window" }))).toBe("Window")
  })

  test("a hairline is drawn only between two rows", () => {
    const rows = (types: string[]) =>
      buildSegments(
        ctx(),
        types.map((type) => ({ type })),
        { icons: false },
      ).map((segment) => segment.id)
    expect(rows(["sep", "in", "sep", "sep", "out", "sep"])).toEqual(["in", "sep#2", "out"])
  })

  test("the widest row stays inside a sidebar", () => {
    for (const entry of SIDEBAR_SEGMENTS) {
      const drawn = buildSegments(ctx({ budget: { spent: 1, cap: 10 } }), [asSegmentConfig(entry)], {
        icons: false,
      })[0]
      if (drawn) expect(segmentWidth(drawn)).toBeLessThanOrEqual(34)
    }
  })
})

describe("what the table reads", () => {
  test("a proxy's file: { baseline, delta, cap }", () => {
    expect(parseBudget('{"baseline": 20, "delta": 6.5, "cap": 200}')).toEqual({ spent: 26.5, cap: 200 })
    expect(parseBudget('{"baseline": 20, "cap": 200}')).toEqual({ spent: 20, cap: 200 })
    expect(parseBudget('{"baseline": 20, "cap": 0}')).toBeUndefined()
    expect(parseBudget("not json")).toBeUndefined()
    expect(parseBudget(undefined)).toBeUndefined()
  })

  test("the file is read only when a line draws a budget, and a segment's `file` points elsewhere", () => {
    expect(budgetFile([{ segments: ["in", "git"] }])).toBeUndefined()
    expect(budgetFile([{ segments: ["spend"] }], "/home/u")).toBe(
      "/home/u/.cache/opencode-litellm-iap/spend.json",
    )
    expect(budgetFile([{ segments: [{ type: "avail", file: "~/b.json" }] }], "/home/u")).toBe(
      "/home/u/b.json",
    )
  })

  test("git runs only for a line that draws it — uncommitted by default, the branch when asked", () => {
    expect(wantsBranchDiff([{ segments: ["git.diff"] }])).toBe(false)
    expect(wantsBranchDiff([{ segments: SIDEBAR_SEGMENTS }])).toBe(false)
    expect(wantsDiff([{ segments: SIDEBAR_SEGMENTS }])).toBe(true)
    expect(wantsBranchDiff([{ segments: [{ type: "git", against: "branch" }] }])).toBe(true)
    expect(wantsDiff([{ segments: [{ type: "git", against: "branch" }] }])).toBe(false)
    expect(branchDiffCommand("main")).toBe(`git diff --shortstat "$(git merge-base 'main' HEAD)"`)
    expect(branchDiffCommand("it's")).toContain(`'it'\\''s'`)
  })
})
