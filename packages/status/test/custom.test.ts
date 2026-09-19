import { describe, expect, test } from "bun:test"
import type { StatusContext } from "../src/core/context.ts"
import { type CustomModule, loadCustomSegments, resolveModulePath } from "../src/core/custom.ts"
import { fitColumn } from "../src/core/render.ts"
import { buildSegments, type Segment, segmentText } from "../src/core/segments.ts"

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

/** Loads from an in-memory module rather than a file, so the tests need no fixtures on disk. */
const load = (modules: Record<string, CustomModule>) =>
  loadCustomSegments(Object.keys(modules), "/w/app", async (path) => {
    const key = Object.keys(modules).find((name) => path.endsWith(name.replace(/^[~.]\//, "")))
    if (!key) throw new Error("Cannot find module")
    return { default: modules[key] }
  })

describe("where a module is looked for", () => {
  test("a tilde is home, absolute is itself, anything else is relative to the project", () => {
    expect(resolveModulePath("~/s.ts", "/w/app", "/home/u")).toBe("/home/u/s.ts")
    expect(resolveModulePath("/etc/s.ts", "/w/app", "/home/u")).toBe("/etc/s.ts")
    expect(resolveModulePath("./line.ts", "/w/app", "/home/u")).toBe("/w/app/line.ts")
    expect(resolveModulePath("line.ts", "/w/app", "/home/u")).toBe("/w/app/line.ts")
  })
})

describe("loading your own segments", () => {
  test("a function becomes a segment usable by name", async () => {
    const { segments, errors } = await load({
      "./mine.ts": { segments: { hello: () => ({ text: "hi", tone: "success" }) } },
    })
    expect(errors).toEqual([])

    const [drawn] = buildSegments(ctx(), [{ type: "hello" }], { custom: segments })
    expect(segmentText(drawn as Segment)).toBe("hi")
    expect(drawn?.runs[0]?.tone).toBe("success")
  })

  test("a plain string is enough, and an empty one hides the segment", async () => {
    const { segments } = await load({
      "./mine.ts": {
        segments: {
          full: () => "something",
          empty: () => "",
          absent: () => undefined,
        },
      },
    })
    const built = buildSegments(ctx(), [{ type: "full" }, { type: "empty" }, { type: "absent" }], segments)
    expect(built.map((s) => s.id)).toEqual(["full"])
  })

  test("it is handed the same snapshot the built-ins get, and its own settings", async () => {
    let seen: StatusContext | undefined
    const { segments } = await load({
      "./mine.ts": {
        segments: {
          echo: (context, config) => {
            seen = context
            return String(config.label ?? "")
          },
        },
      },
    })
    const [drawn] = buildSegments(ctx({ branch: "main" }), [{ type: "echo", label: "x" }], {
      custom: segments,
    })
    expect(segmentText(drawn as Segment)).toBe("x")
    expect(seen?.branch).toBe("main")
  })

  test("a priority can be declared, and defaults otherwise", async () => {
    const { segments } = await load({
      "./mine.ts": {
        segments: {
          loud: { render: () => "a", priority: 99 },
          quiet: () => "b",
        },
      },
    })
    const built = buildSegments(ctx(), [{ type: "loud" }, { type: "quiet" }], segments)
    expect(built[0]?.priority).toBe(99)
    expect(built[1]?.priority).toBe(45)
  })

  // Your line is not worth losing over one bad segment.
  test("a segment that throws costs its own place and nothing else", async () => {
    const { segments } = await load({
      "./mine.ts": {
        segments: {
          bad: () => {
            throw new Error("boom")
          },
        },
      },
    })
    const built = buildSegments(ctx(), [{ type: "bad" }, { type: "version" }], segments)
    expect(built.map((s) => s.id)).toEqual(["version"])
  })

  test("a module can replace a built-in by using its name", async () => {
    const { segments } = await load({
      "./mine.ts": { segments: { cwd: () => "MY-CWD" } },
    })
    const [drawn] = buildSegments(ctx(), [{ type: "cwd" }], { custom: segments, icons: false })
    expect(segmentText(drawn as Segment)).toBe("MY-CWD")
  })

  // The failure mode to avoid is segments quietly missing from the line with no explanation.
  test("a module that will not load is reported rather than swallowed", async () => {
    const { segments, errors } = await loadCustomSegments(["./nope.ts"], "/w/app", async () => {
      throw new Error("Cannot find module")
    })
    expect(segments.size).toBe(0)
    expect(errors[0]).toContain("./nope.ts")
    expect(errors[0]).toContain("Cannot find module")
  })

  test("an export that is not a function is reported, and its siblings still load", async () => {
    const { segments, errors } = await load({
      "./mine.ts": {
        segments: { broken: 42 as never, fine: () => "ok" },
      },
    })
    expect(errors[0]).toContain('segment "broken"')
    expect(segments.has("fine")).toBe(true)
  })
})

describe("stacking down a column", () => {
  const seg = (id: string, text: string, priority: number): Segment => ({
    id,
    runs: [{ text, tone: "muted" }],
    priority,
  })

  test("every segment takes a row, cut to the column's width", () => {
    const out = fitColumn([seg("a", "a-long-value", 50), seg("b", "short", 50)], 6, 8)
    expect(out.segments.map((s) => segmentText(s))).toEqual(["a-lon…", "short"])
  })

  // Down a column the limit is rows, not columns, so nothing is merged onto one line.
  test("more segments than rows drops the least important, keeping written order", () => {
    const out = fitColumn([seg("a", "aa", 10), seg("b", "bb", 90), seg("c", "cc", 50)], 20, 2)
    expect(out.segments.map((s) => s.id)).toEqual(["b", "c"])
    expect(out.dropped).toBe(1)
  })

  test("no room means no rows rather than a crash", () => {
    expect(fitColumn([seg("a", "x", 1)], 0, 5).segments).toEqual([])
    expect(fitColumn([seg("a", "x", 1)], 10, 0).segments).toEqual([])
  })
})
