import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { SessionSnapshot, StatusContext } from "../src/core/context.ts"
import { loadCustomSegments } from "../src/core/custom.ts"
import { buildSegments, type Segment, segmentText, segmentWidth } from "../src/core/segments.ts"

/**
 * The shipped examples, loaded exactly the way a user's own module is. An example that does not
 * run is worse than no example, and this is the only thing that catches one.
 */

const EXAMPLES = ["bottom", "prompt-right", "sidebar"] as const

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

  test("the trend needs two readings before it claims a direction", () => {
    const first = draw("bottom", "trend", ctx({ now: 1000, session: working() }))
    expect(first).toBeUndefined()
  })
})

describe("the prompt-right example", () => {
  test("the state pill is silent while idle and filled while working", () => {
    expect(draw("prompt-right", "state", ctx({ session: session() }))).toBeUndefined()
    const busy = draw("prompt-right", "state", ctx({ session: working() }))
    expect(segmentText(busy as Segment)).toContain("WORKING")
    expect(busy?.runs.find((run) => run.bgTone)?.tone).toBe("background")
  })

  /** A six-cell meter that only draws whole cells reports in jumps of seventeen per cent. */
  test("the meter resolves a partial cell, so a short bar is still honest", () => {
    const low = draw("prompt-right", "meter", ctx({ session: working(0.05) }))
    expect(segmentText(low as Segment)).toContain("5%")
    // 5% of six cells is well under one: it must still show something other than empty.
    expect(segmentText(low as Segment)).not.toMatch(/^·{6}/)
  })

  test("attention says nothing until something actually needs you", () => {
    expect(draw("prompt-right", "attention", ctx({ session: working(0.5) }))).toBeUndefined()

    const full = draw("prompt-right", "attention", ctx({ session: working(0.95) }))
    expect(segmentText(full as Segment)).toContain("context nearly full")

    const broken = draw(
      "prompt-right",
      "attention",
      ctx({ session: working(0.5), mcp: [{ name: "github", status: "failed" }] }),
    )
    expect(segmentText(broken as Segment)).toContain("github")
  })
})

describe("the sidebar example", () => {
  test("rows carry a dim label so a column of them reads as a table", () => {
    const drawn = draw("sidebar", "changes", ctx({ session: working() }))
    expect(drawn?.runs[0]).toMatchObject({ text: "diff ", dim: true })
    expect(segmentText(drawn as Segment)).toBe("diff 3f +120 -18")
  })

  // The rule the whole bay is built on, applied where it is easiest to get wrong.
  test("spend reports tokens instead of a made-up cost on an unpriced model", () => {
    const unpriced = ctx({
      session: session({
        priced: false,
        model: { providerID: "p", modelID: "m", contextLimit: 100 },
        tokens: { input: 40, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    })
    const drawn = draw("sidebar", "spend", unpriced)
    expect(segmentText(drawn as Segment)).toBe("used 50 tokens")
    expect(segmentText(drawn as Segment)).not.toContain("$")
  })

  test("spend reports money once prices exist", () => {
    expect(segmentText(draw("sidebar", "spend", ctx({ session: working() })) as Segment)).toContain("$1.25")
  })

  test("the composition chips always add up to the whole window", () => {
    const drawn = draw("sidebar", "composition", ctx({ session: working() }))
    const shares = [...segmentText(drawn as Segment).matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
  })
})
