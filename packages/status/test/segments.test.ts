import { describe, expect, test } from "bun:test"
import type { SessionSnapshot, StatusContext } from "../src/core/context.ts"
import { buildSegments, findSegment } from "../src/core/segments.ts"

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

/** One segment, rendered on its own: what the line would show for just that built-in. */
const render = (type: string, context: StatusContext, config: Record<string, unknown> = {}) =>
  buildSegments(context, [{ type, ...config }])[0]

describe("a segment with nothing to say says nothing", () => {
  test("no session means no session-shaped segments", () => {
    const empty = ctx()
    for (const type of ["git.diff", "model", "context", "cost", "todo", "session.status"]) {
      expect(render(type, empty)).toBeUndefined()
    }
  })

  test("no branch, no branch segment", () => {
    expect(render("git.branch", ctx())).toBeUndefined()
  })

  test("healthy services are silent", () => {
    const healthy = ctx({ lsp: [{ name: "tsserver", status: "connected" }], mcp: [] })
    expect(render("diagnostics", healthy)).toBeUndefined()
  })

  test("idle is silent, because it is the normal state", () => {
    expect(render("session.status", ctx({ session: session() }))).toBeUndefined()
  })
})

describe("cost never claims a number nobody configured", () => {
  /**
   * The case behind this: a proxy such as LiteLLM, where OpenCode's catalogue knows no prices, so
   * cost is 0 because nothing was declared — not because the work was free. Showing "$0.00" there
   * would be a confident lie.
   */
  test("an unpriced provider hides the segment even with messages spent", () => {
    const spent = ctx({ session: session({ priced: false, cost: 0, messages: 20 }) })
    expect(render("cost", spent)).toBeUndefined()
  })

  test("a priced provider with real spend shows it", () => {
    const spent = ctx({ session: session({ priced: true, cost: 1.234 }) })
    expect(render("cost", spent)?.text).toBe("$1.23")
  })

  test("a priced provider at zero stays quiet unless asked", () => {
    const fresh = ctx({ session: session({ priced: true, cost: 0 }) })
    expect(render("cost", fresh)).toBeUndefined()
    expect(render("cost", fresh, { showZero: true })?.text).toBe("$0")
  })
})

describe("context window", () => {
  const withLimit = (used: number, limit?: number) =>
    ctx({
      session: session({
        ...(limit
          ? { model: { providerID: "p", modelID: "m", contextLimit: limit } }
          : {
              model: { providerID: "p", modelID: "m" },
            }),
        tokens: { input: used, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    })

  // Behind a proxy nobody declares limit.context, and a percentage needs a denominator.
  test("no declared window means no percentage invented", () => {
    expect(render("context", withLimit(50_000))).toBeUndefined()
  })

  test("reports the share of the window in use", () => {
    expect(render("context", withLimit(50_000, 200_000))?.text).toBe("25% ctx")
  })

  test("warns and then alarms as it fills", () => {
    expect(render("context", withLimit(50_000, 200_000))?.tone).toBe("muted")
    expect(render("context", withLimit(160_000, 200_000))?.tone).toBe("warning")
    expect(render("context", withLimit(190_000, 200_000))?.tone).toBe("error")
  })

  test("the thresholds are settable", () => {
    expect(render("context", withLimit(100_000, 200_000), { warnAt: 0.4 })?.tone).toBe("warning")
  })

  test("the bar style is exactly as wide as asked, plus its brackets and figure", () => {
    const drawn = render("context", withLimit(100_000, 200_000), { style: "bar", width: 6 })
    expect(drawn?.text).toMatch(/^\[.{6}\] 50%$/)
  })

  test("counts cache and reasoning, which is what actually occupies the window", () => {
    const full = ctx({
      session: session({
        model: { providerID: "p", modelID: "m", contextLimit: 1000 },
        tokens: { input: 100, output: 100, reasoning: 100, cache: { read: 100, write: 100 } },
      }),
    })
    expect(render("context", full)?.text).toBe("50% ctx")
  })
})

describe("the rest of the built-ins", () => {
  test("cwd names the root and relativises inside it", () => {
    expect(render("cwd", ctx())?.text).toBe("app")
    expect(render("cwd", ctx({ directory: "/w/app/src" }))?.text).toBe("src")
  })

  // Outside both the worktree and home a path has no short form, and an absolute one can be wider
  // than the terminal; the tail is the half that says where you are.
  test("a long path outside the worktree is cut from the left, not left to eat the line", () => {
    const far = ctx({ directory: "/private/var/folders/zz/T/ck-probe-AbCdEf/project" })
    const drawn = render("cwd", far)
    expect(drawn?.text).toBe("…z/T/ck-probe-AbCdEf/project")
    expect((drawn?.text ?? "").length).toBeLessThanOrEqual(28)
    expect(render("cwd", far, { maxWidth: 10 })?.text).toHaveLength(10)
  })

  test("a feature branch stands out from the default branch", () => {
    const feature = ctx({ branch: "status-bay", defaultBranch: "main" })
    const boring = ctx({ branch: "main", defaultBranch: "main" })
    expect(render("git.branch", feature)?.tone).toBe("info")
    expect(render("git.branch", boring)?.tone).toBe("muted")
  })

  test("diff shows only when something changed", () => {
    expect(render("git.diff", ctx({ session: session() }))).toBeUndefined()
    const changed = ctx({ session: session({ diff: { files: 2, additions: 40, deletions: 3 } }) })
    expect(render("git.diff", changed)?.text).toBe("+40/-3")
  })

  test("todo counts down and turns green when it is done", () => {
    const busy = ctx({ session: session({ todo: { total: 7, completed: 3 } }) })
    const done = ctx({ session: session({ todo: { total: 7, completed: 7 } }) })
    expect(render("todo", busy)?.text).toBe("3/7 todo")
    expect(render("todo", busy)?.tone).toBe("muted")
    expect(render("todo", done)?.tone).toBe("success")
  })

  // A session that is retrying looks identical to a slow one in OpenCode today.
  test("a retry says which attempt and how long until the next", () => {
    const retrying = ctx({
      now: 1000,
      session: session({
        status: "retry",
        retry: { attempt: 2, message: "rate limited", next: 6000 },
      }),
    })
    const drawn = render("session.status", retrying)
    expect(drawn?.text).toBe("retry 2 in 5s")
    expect(drawn?.tone).toBe("warning")
  })

  test("busy reports how long it has been working", () => {
    const working = ctx({ now: 90_000, session: session({ status: "busy", startedAt: 30_000 }) })
    expect(render("session.status", working)?.text).toBe("working 1m")
  })

  test("diagnostics name what is broken and count the rest", () => {
    const broken = ctx({
      lsp: [
        { name: "tsserver", status: "error" },
        { name: "gopls", status: "connected" },
      ],
      mcp: [
        { name: "github", status: "failed" },
        { name: "jira", status: "failed" },
      ],
    })
    expect(render("diagnostics", broken)?.text).toBe("⚠ tsserver, github +1")
    expect(render("diagnostics", broken)?.tone).toBe("error")
  })

  test("a command segment shows whatever the command last returned", () => {
    const withCommand = ctx({ commands: { budget: "$412 left" } })
    expect(render("command", withCommand, { name: "budget" })?.text).toBe("$412 left")
    expect(render("command", ctx(), { name: "budget" })).toBeUndefined()
  })

  test("literal text is passed through", () => {
    expect(render("text", ctx(), { value: "prod" })?.text).toBe("prod")
    expect(render("text", ctx())).toBeUndefined()
  })
})

describe("building a line", () => {
  test("drops the quiet segments and keeps the order written", () => {
    const context = ctx({ branch: "main", session: session({ priced: true, cost: 2 }) })
    const built = buildSegments(context, [
      { type: "cwd" },
      { type: "git.branch" },
      { type: "cost" },
      { type: "todo" }, // nothing to say
    ])
    expect(built.map((s) => s.id)).toEqual(["cwd", "git.branch", "cost"])
  })

  // A config written against a newer version should cost you the segment, not the line.
  test("an unknown segment type is skipped rather than fatal", () => {
    const built = buildSegments(ctx(), [{ type: "does.not.exist" }, { type: "cwd" }])
    expect(built.map((s) => s.id)).toEqual(["cwd"])
  })

  test("prefix and suffix wrap the value", () => {
    const built = buildSegments(ctx({ branch: "main" }), [{ type: "git.branch", prefix: "on ", suffix: "!" }])
    expect(built[0]?.text).toBe("on main!")
  })

  test("the same type twice gets distinct ids, so fitting can drop one", () => {
    const built = buildSegments(ctx(), [
      { type: "text", value: "a" },
      { type: "text", value: "b" },
    ])
    expect(built.map((s) => s.id)).toEqual(["text", "text#2"])
  })

  test("a configured tone wins, and a hex colour is carried through", () => {
    const [tone] = buildSegments(ctx({ branch: "main" }), [{ type: "git.branch", color: "error" }])
    expect(tone?.tone).toBe("error")
    const [hex] = buildSegments(ctx({ branch: "main" }), [{ type: "git.branch", color: "#ff8800" }])
    expect(hex?.color).toBe("#ff8800")
  })

  test("priority falls back to the built-in's own", () => {
    const [own] = buildSegments(ctx(), [{ type: "cwd" }])
    expect(own?.priority).toBe(findSegment("cwd")?.priority)
    const [set] = buildSegments(ctx(), [{ type: "cwd", priority: 5 }])
    expect(set?.priority).toBe(5)
  })
})
