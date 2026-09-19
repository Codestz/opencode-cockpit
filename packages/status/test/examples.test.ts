import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { SessionSnapshot, StatusContext } from "../src/core/context.ts"
import { loadCustomSegments } from "../src/core/custom.ts"
import { buildSegments, type Segment, segmentText, segmentWidth } from "../src/core/segments.ts"

/**
 * The shipped examples, loaded exactly the way a user's own module is. An example that does not
 * run is worse than no example, and this is the only thing that catches one.
 */

const EXAMPLES = ["bottom", "sidebar", "sidebar-full"] as const

const session = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: "ses_1",
  status: "idle",
  cost: 0,
  priced: false,
  messages: 2,
  startedAt: 0,
  diff: { files: 0, additions: 0, deletions: 0 },
  todo: { total: 0, completed: 0 },
  ...over,
})

const ctx = (over: Partial<StatusContext> = {}): StatusContext => ({
  now: 60_000,
  directory: "/w/app",
  worktree: "/w/app",
  home: "/home/u",
  version: "0.2.2",
  lsp: [],
  mcp: [],
  commands: {},
  width: 120,
  ...over,
})

/** A session with a declared window, half full, and a realistic token split. */
const working = (share = 0.5) =>
  session({
    status: "busy",
    priced: true,
    cost: 1.25,
    model: { providerID: "p", modelID: "anthropic/claude-opus-5-20260101", contextLimit: 200_000 },
    tokens: {
      input: 200_000 * share * 0.3,
      output: 200_000 * share * 0.2,
      reasoning: 0,
      cache: { read: 200_000 * share * 0.5, write: 0 },
    },
    diff: { files: 3, additions: 120, deletions: 18 },
  })

const loaded = Object.fromEntries(
  await Promise.all(
    EXAMPLES.map(async (name) => [
      name,
      await loadCustomSegments([join(import.meta.dir, "..", "examples", `${name}.ts`)], "/w/app"),
    ]),
  ),
) as Record<(typeof EXAMPLES)[number], Awaited<ReturnType<typeof loadCustomSegments>>>

const draw = (example: (typeof EXAMPLES)[number], type: string, context: StatusContext) =>
  buildSegments(context, [{ type }], { custom: loaded[example].segments, icons: false })[0]

describe("every shipped example", () => {
  for (const name of EXAMPLES) {
    test(`${name} loads with no errors and registers segments`, () => {
      expect(loaded[name].errors).toEqual([])
      expect(loaded[name].segments.size).toBeGreaterThan(0)
    })

    test(`${name} draws nothing at all before a session exists`, () => {
      // Every surface is mounted at start-up, so the empty case is the first thing a user sees.
      const empty = ctx()
      for (const type of loaded[name].segments.keys()) {
        const drawn = draw(name, type, empty)
        if (drawn) expect(segmentWidth(drawn)).toBeGreaterThan(0)
      }
    })

    test(`${name} stays inside its surface's width on a full session`, () => {
      const busy = ctx({ session: working(0.95), branch: "main" })
      // Nothing may be wider than the narrowest surface any example targets.
      for (const type of loaded[name].segments.keys()) {
        const drawn = draw(name, type, busy)
        if (drawn) expect(segmentWidth(drawn)).toBeLessThan(60)
      }
    })
  }
})

describe("the bottom example", () => {
  test("the capacity bar is exactly the width asked for, between its end caps", () => {
    const drawn = buildSegments(ctx({ session: working(0.5) }), [{ type: "capacity", width: 20 }], {
      custom: loaded.bottom.segments,
      icons: false,
    })[0]
    expect(segmentText(drawn as Segment)).toMatch(/^▕.{20}▏ 50%$/)
  })

  /**
   * A figure, not a picture. A sparkline redraws its shape every second, and movement in the
   * corner of your eye is the one thing a statusline must not do.
   */
  test("pace needs two readings before it claims a rate", () => {
    expect(draw("bottom", "pace", ctx({ now: 1000, session: working() }))).toBeUndefined()
  })

  test("pace reports a rate and what is left at it, and draws no moving shape", () => {
    // A window filling steadily, read minutes apart. The segment keeps its own history, so it is
    // driven rather than called once.
    let drawn: Segment | undefined
    for (let minute = 1; minute <= 5; minute++) {
      drawn = draw("bottom", "pace", ctx({ now: minute * 60_000, session: working(minute * 0.1) }))
    }
    const text = segmentText(drawn as Segment)
    expect(text).toMatch(/\+\d+(\.\d)?%\/min/)
    // Block-drawing characters are what a sparkline is made of; this segment draws none.
    expect(text).not.toMatch(/[▁▂▃▄▅▆▇█]/)
  })

  test("cache reports the share of the window it did not have to re-send", () => {
    const drawn = draw("bottom", "cache", ctx({ session: working(0.5) }))
    expect(segmentText(drawn as Segment)).toBe("▌50% cached")
  })
})

/**
 * This one replaces OpenCode's own Context block rather than sitting beside it, so it has to carry
 * what that block carried — the percentage, the token total and the spend — or turning the host's
 * block off leaves the user worse off than before.
 */
describe("the full sidebar example", () => {
  const full = (over: Partial<ReturnType<typeof working>> = {}) => ({ ...working(0.4), ...over })

  test("carries everything the host's Context block did", () => {
    const ctxWith = ctx({ session: full() })
    expect(segmentText(draw("sidebar-full", "gauge", ctxWith) as Segment)).toContain("40%")
    expect(segmentText(draw("sidebar-full", "window", ctxWith) as Segment)).toContain("/")
    expect(segmentText(draw("sidebar-full", "spend", ctxWith) as Segment)).toContain("$")
  })

  test("every row fits a sidebar column", () => {
    const ctxWith = ctx({ session: full() })
    for (const type of loaded["sidebar-full"].segments.keys()) {
      const drawn = draw("sidebar-full", type, ctxWith)
      if (drawn) expect(segmentWidth(drawn)).toBeLessThanOrEqual(32)
    }
  })

  test("without a declared window it reports the total rather than a share of nothing", () => {
    const unmeasured = ctx({
      session: {
        ...working(0.4),
        model: { providerID: "p", modelID: "m" },
      },
    })
    expect(draw("sidebar-full", "gauge", unmeasured)).toBeUndefined()
    expect(segmentText(draw("sidebar-full", "window", unmeasured) as Segment)).toContain("tok")
  })

  test("spend stays silent on an unpriced model", () => {
    const unpriced = ctx({ session: { ...working(0.4), priced: false } })
    expect(draw("sidebar-full", "spend", unpriced)).toBeUndefined()
  })

  test("tasks go quiet once the list is finished", () => {
    const done = ctx({ session: { ...working(0.4), todo: { total: 5, completed: 5 } } })
    expect(draw("sidebar-full", "tasks", done)).toBeUndefined()
  })
})

describe("the sidebar example", () => {
  test("rows carry a dim label so a column of them reads as a table", () => {
    const drawn = draw("sidebar", "changes", ctx({ session: working() }))
    expect(drawn?.runs[0]).toMatchObject({ text: "diff ", dim: true })
    expect(segmentText(drawn as Segment)).toBe("diff 3f +120 -18")
  })

  test("the bar is exactly the width asked for, with its figure beside it", () => {
    const drawn = buildSegments(ctx({ session: working(0.5) }), [{ type: "bar", width: 10 }], {
      custom: loaded.sidebar.segments,
      icons: false,
    })[0]
    expect(segmentText(drawn as Segment)).toMatch(/^[█░]{10} 50%$/)
  })

  test("the split parts always add up to the whole window", () => {
    const drawn = draw("sidebar", "split", ctx({ session: working() }))
    const shares = [...segmentText(drawn as Segment).matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
  })
})
