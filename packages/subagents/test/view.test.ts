import { describe, expect, test } from "bun:test"
import { createV1Translator } from "../src/core/adapt/v1.ts"
import { createV2Translator } from "../src/core/adapt/v2.ts"
import type { Change } from "../src/core/model/changes.ts"
import { applyAll, emptyModel, type Node, type Session, subagentsOf } from "../src/core/model/model.ts"
import { markdownRows } from "../src/core/view/markdown.ts"
import { cut, elapsed, fit, rowText, widthOf, wrap } from "../src/core/view/rows.ts"
import { createScreenCache, rowWidth, type ScreenInput, screenRows } from "../src/core/view/screen.ts"
import { sidebarLines } from "../src/core/view/sidebar.ts"
import { recorded } from "./fixtures.ts"

/**
 * The grid rule (docs/building/terminal-ui.md): every row a surface draws is exactly its width, and
 * the full screen is exactly its height — at every width, for both recorded runs. A row one column
 * short leaves a tint that stops before the edge; one column long wraps and pushes everything down.
 */

async function model(version: 1 | 2) {
  const { events, history } = await recorded(version)
  const translate = version === 1 ? createV1Translator() : createV2Translator()
  const changes: Change[] = events.flatMap((line) => translate.event(line.event, line.at))
  const m = applyAll(emptyModel(), changes)
  const parent = history.parent as string
  return { nodes: subagentsOf(m, parent), parent, model: m }
}

const WIDTHS = [12, 20, 26, 34, 42, 60, 90, 140]

/** A pane at rest: nothing selected, nothing opened by hand, following the run. */
const pane = (session: Session, nodes: readonly Node[]): ScreenInput => ({
  session,
  nodes,
  width: 140,
  height: 40,
  now: Date.now(),
  frame: 0,
  open: new Set(),
  closed: new Set(),
  thinking: false,
  details: false,
})

for (const version of [1, 2] as const) {
  describe(`OpenCode ${version}'s run, drawn`, () => {
    test("the sidebar block: every row exactly the column's width", async () => {
      const { nodes } = await model(version)
      for (const width of WIDTHS) {
        const lines = sidebarLines({ nodes, width, now: Date.now(), frame: 3 })
        expect(lines.length).toBe(3) // heading, and two lines for the one subagent
        for (const line of lines) expect(rowWidth(line.row)).toBe(width)
      }
    })

    test("both of a subagent's lines open it; the heading opens nothing", async () => {
      const { nodes } = await model(version)
      const lines = sidebarLines({ nodes, width: 40, now: Date.now(), frame: 0 })
      const id = nodes[0]?.session.id
      expect(lines.map((line) => line.id)).toEqual([undefined, id, id])
      expect(rowText(lines[0]?.row ?? []).trimEnd()).toMatch(/^Subagents +1 done$/)
      expect(rowText(lines[1]?.row ?? [])).toContain("explore")
      expect(rowText(lines[2]?.row ?? []).trimEnd()).toMatch(/└ done +\d+ calls · \d+s$/)
    })

    test("the pane: exactly its height, every row exactly its width, in every state", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const every = new Set(screenRows(pane(session, nodes)).keys)
      for (const [width, height] of [
        [40, 12],
        [90, 30],
        [170, 40],
      ] as const) {
        for (const state of [
          {},
          { thinking: true },
          { open: every },
          { details: true },
          { input: { draft: "also check the tests", busy: false } },
          { selected: [...every][1] as string, top: 0 },
        ]) {
          const screen = screenRows({ ...pane(session, nodes), width, height, ...state })
          expect(screen.rows).toHaveLength(height)
          expect(screen.items).toHaveLength(height)
          for (const row of screen.rows) expect(rowWidth(row)).toBe(width)
        }
      }
    })

    test("the pane shows the task, the calls, the model and the answer", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const text = screenRows({ ...pane(session, nodes), height: 200, launcher: "build" })
        .rows.map(rowText)
        .join("\n")
      expect(text).toContain("EXPLORE")
      expect(text).toContain("launched by build")
      expect(text).toContain("space-bunny-free")
      expect(text).toContain("Task from build")
      expect(text).toMatch(/→ Read src\/(session|middleware)\.ts/)
      expect(text).toMatch(/[◇◆] Thought · [\d.]+m?s/)
      expect(text).toContain("createSession")
      expect(text).toContain("[m] Message")
    })

    test("a quiet call is one line; open, it is a box of its arguments; folded, one line again", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const base = { ...pane(session, nodes), height: 200 }
      const call = screenRows(base).keys.find((key) => key.startsWith("tool:")) as string
      const folded = screenRows(base)
      expect(folded.opened).not.toContain(call)
      const opened = screenRows({ ...base, open: new Set([call]) })
      expect(opened.opened).toContain(call)
      const rows = opened.rows.filter((_, i) => opened.items[i] === call).map(rowText)
      expect(rows.every((row) => row.includes("▎"))).toBe(true)
      expect(rows.some((row) => /(Read|Grep|Glob) /.test(row))).toBe(true)
      expect(rows.some((row) => /▎ {2}\w+ {2,}\S/.test(row))).toBe(true)
      expect(opened.rows[opened.items.indexOf(call)]?.some((run) => run.fill === "block")).toBe(true)
      const closed = screenRows({ ...base, open: new Set([call]), closed: new Set([call]) })
      expect(closed.items.filter((item) => item === call)).toHaveLength(1)
    })

    test("the selected item is marked on every row it takes", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const base = { ...pane(session, nodes), height: 200 }
      const call = screenRows(base).keys.find((key) => key.startsWith("tool:")) as string
      const screen = screenRows({ ...base, selected: call, open: new Set([call]), top: 0 })
      screen.rows.forEach((row, i) => {
        expect(rowText(row).startsWith("▌")).toBe(screen.items[i] === call || i === 0)
      })
    })

    test("details: the model, what it is denied, calls by tool", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const text = screenRows({ ...pane(session, nodes), details: true, height: 40 })
        .rows.map(rowText)
        .join("\n")
      expect(text).toMatch(/Model +space-bunny-free/)
      expect(text).toMatch(/Calls +\d+ {2}— {2}\d+ read/)
      if (version === 1) expect(text).toMatch(/Denied +todowrite, task/)
      expect(text).toContain(`Session   ${session.id}`)
    })

    test("scrolling up shows earlier rows, and stops at the start", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const base = { ...pane(session, nodes), width: 80, height: 14 }
      const bottom = screenRows(base)
      const far = screenRows({ ...base, top: -5 })
      expect(bottom.most).toBeGreaterThan(0)
      expect(bottom.top).toBe(bottom.most)
      expect(far.top).toBe(0)
      expect(far.rows.map(rowText).join("\n")).toContain("Task")
      expect(far.rows).toHaveLength(14)
    })
  })
}

describe("while it works", () => {
  const at = 1_000_000
  const running: Change[] = [
    { type: "session", id: "c", parentID: "p", agent: "general", title: "Regenerate API types", at },
    { type: "prompt", id: "c", key: "u", text: "Run the codegen and fix what breaks.", at },
    { type: "status", id: "c", status: "busy", at },
    {
      type: "tool",
      id: "c",
      call: "1",
      name: "bash",
      state: "running",
      input: { command: "pnpm gen:types" },
      output: "generating…\nwrote 12 files\n",
      at,
    },
  ]

  test("the sidebar says the call, how many, and how long it has run", () => {
    const m = applyAll(emptyModel(), running)
    const lines = sidebarLines({ nodes: subagentsOf(m, "p"), width: 40, now: at + 72_000, frame: 1 })
    expect(rowText(lines[0]?.row ?? []).trimEnd()).toMatch(/1 running$/)
    const second = rowText(lines[2]?.row ?? [])
    expect(second).toContain("└ bash pnpm gen:types")
    expect(second.trimEnd()).toMatch(/1 call · 1m12s$/)
  })

  test("a shell command is a box: the command, then what it prints as it runs", () => {
    const m = applyAll(emptyModel(), running)
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const base = { ...pane(session, nodes), width: 80, height: 20, now: at + 4000 }
    const text = screenRows(base).rows.map(rowText).join("\n")
    expect(text).toContain("running 4s")
    expect(text).toMatch(/▎ {2}\$ pnpm gen:types/)
    expect(text).toMatch(/▎ {2}wrote 12 files/)
  })

  test("a quick call shows no time; a slow one does", () => {
    const calls: Change[] = [
      ...running.slice(0, 3),
      {
        type: "tool",
        id: "c",
        call: "q",
        name: "read",
        state: "completed",
        input: { filePath: "/w/a.ts" },
        started: at,
        ended: at + 7,
        at,
      },
      {
        type: "tool",
        id: "c",
        call: "s",
        name: "grep",
        state: "completed",
        input: { pattern: "x" },
        summary: "9 matches",
        started: at,
        ended: at + 1400,
        at,
      },
    ]
    const m = applyAll(emptyModel(), calls)
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const rows = screenRows({ ...pane(session, nodes), width: 80, height: 20 }).rows.map((row) =>
      rowText(row).trimEnd(),
    )
    expect(rows.find((row) => row.includes("a.ts"))).toMatch(/a\.ts$/)
    expect(rows.find((row) => row.includes("Grep"))).toMatch(/9 matches · 1\.4s$/)
  })

  test("typing a message: the draft at the foot, and where it goes", () => {
    const m = applyAll(emptyModel(), running)
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const text = screenRows({
      ...pane(session, nodes),
      width: 90,
      height: 20,
      input: { draft: "skip the docs", busy: true },
    })
      .rows.map(rowText)
      .join("\n")
    expect(text).toContain("┃ skip the docs▍")
    expect(text).toContain("it picks this up in its current run")
    expect(text).not.toContain("[m] Message")
  })

  test("a message you sent is a card in the timeline", () => {
    const m = applyAll(emptyModel(), [
      ...running,
      { type: "prompt", id: "c", key: "u2", text: "Also run the tests.", at: at + 1 },
    ])
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const screen = screenRows({ ...pane(session, nodes), width: 80, height: 30 })
    const text = screen.rows.map(rowText).join("\n")
    expect(text).toContain("▎ You")
    expect(text).toContain("▎ Also run the tests.")
    expect(screen.keys).toContain("prompt:u2")
  })
})

describe("markdown", () => {
  test("headings, bold, code, lists and fences — drawn, not shown as source", () => {
    const rows = markdownRows(
      "## Findings\n\nThe **session** lives in `auth/session.ts`.\n\n- one\n- two\n\n```\nconst a = 1\n```",
      50,
      { indent: 2 },
    )
    const text = rows.map(rowText).join("\n")
    expect(text).not.toContain("##")
    expect(text).not.toContain("**")
    expect(text).not.toContain("`")
    expect(text).toContain("• one")
    expect(text).toContain("│ const a = 1")
    for (const row of rows) expect(rowWidth(row)).toBe(50)
    const bold = rows.flat().find((run) => run.text === "session")
    expect(bold?.bold).toBe(true)
    const code = rows.flat().find((run) => run.text === "auth/session.ts")
    expect(code?.tone).toBe("tool")
  })

  test("a code span that crosses the edge keeps its colour on both lines", () => {
    const rows = markdownRows("see `packages/subagents/src/core/view/markdown.ts` here", 24, { indent: 0 })
    const coded = rows.flat().filter((run) => run.tone === "tool")
    expect(coded.length).toBeGreaterThan(1)
    for (const row of rows) expect(rowWidth(row)).toBe(24)
  })
})

describe("text in columns", () => {
  test("cut and fit hold the width, wide characters counted as two", () => {
    expect(cut("hello world", 6)).toBe("hello…")
    expect(widthOf("日本")).toBe(4)
    expect(rowText(fit([{ text: "日本語のテキスト" }], 7)).length).toBeLessThanOrEqual(7)
    expect(widthOf(rowText(fit([{ text: "日本語のテキスト" }], 7)))).toBe(7)
  })

  test("wrap keeps newlines and breaks a word longer than the line", () => {
    expect(wrap("one two three", 7)).toEqual(["one two", "three"])
    expect(wrap("a\n\nb", 10)).toEqual(["a", "", "b"])
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"])
  })

  test("durations read short", () => {
    expect(elapsed(4_000)).toBe("4s")
    expect(elapsed(124_000)).toBe("2m04s")
    expect(elapsed(4_380_000)).toBe("1h13m")
  })
})

describe("stopping and ending", () => {
  const at = 2_000_000
  const working: Change[] = [
    { type: "session", id: "c", parentID: "p", agent: "general", title: "Sleep", at },
    { type: "status", id: "c", status: "busy", at },
    { type: "tool", id: "c", call: "1", name: "bash", state: "running", input: { command: "sleep 40" }, at },
    { type: "reply", id: "c", key: "r", delta: "Sleeping", at },
  ]

  test("a run that ends leaves no call running and no answer still being written", () => {
    for (const end of [
      { type: "status", id: "c", status: "failed", error: "aborted", at: at + 5000 },
      { type: "status", id: "c", status: "idle", at: at + 5000 },
    ] as Change[]) {
      const m = applyAll(emptyModel(), [...working, end])
      const session = m.sessions.get("c")
      const call = session?.entries.find((entry) => entry.kind === "tool")
      expect(call).toMatchObject({ state: "failed", error: "stopped", ended: at + 5000 })
      expect(session?.entries.find((entry) => entry.kind === "reply")).toMatchObject({ done: true })
      const lines = sidebarLines({ nodes: subagentsOf(m, "p"), width: 40, now: at + 9000, frame: 0 })
      expect(rowText(lines[0]?.row ?? [])).not.toContain("running")
    }
  })

  test("x says Stop while it works and Remove once it is done; keys give way at half width", () => {
    const busy = applyAll(emptyModel(), working)
    const done = applyAll(emptyModel(), [...working, { type: "status", id: "c", status: "idle", at: at + 1 }])
    const footer = (m: typeof busy, width: number) => {
      const nodes = subagentsOf(m, "p")
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const rows = screenRows({ ...pane(session, nodes), width, height: 20 }).rows
      return rowText(rows.at(-2) ?? [])
    }
    expect(footer(busy, 140)).toContain("[x] Stop")
    expect(footer(done, 140)).toContain("[x] Remove")
    const narrow = footer(busy, 72)
    expect(narrow).toContain("[enter] Open")
    expect(narrow).toContain("[m] Message")
    expect(narrow).toContain("[x] Stop")
    expect(narrow).not.toMatch(/…\s*$/)
  })
})

describe("calls, as OpenCode draws them", () => {
  const at = 3_000_000
  const lines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n")
  const run = (calls: Change[]) => {
    const m = applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "general", title: "Probe", at },
      { type: "status", id: "c", status: "busy", at },
      ...calls,
    ])
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    return (open: string[] = []) =>
      screenRows({ ...pane(session, nodes), width: 90, height: 60, open: new Set(open) })
  }

  test("a long output folds to ten lines and says it can open; open, it shows all", () => {
    const draw = run([
      {
        type: "tool",
        id: "c",
        call: "b",
        name: "bash",
        state: "completed",
        input: { command: "ls" },
        output: lines,
        at,
      },
    ])
    const folded = draw().rows.map(rowText).join("\n")
    expect(folded).toContain("line 10")
    expect(folded).not.toContain("line 11")
    expect(folded).toContain("Click to expand")
    const open = draw(["tool:b"]).rows.map(rowText).join("\n")
    expect(open).toContain("line 14")
    expect(open).toContain("Click to collapse")
  })

  test("a failed command's edge and output are the error colour", () => {
    const screen = run([
      {
        type: "tool",
        id: "c",
        call: "f",
        name: "bash",
        state: "failed",
        input: { command: "false" },
        error: "fatal: no",
        at,
      },
    ])()
    const rows = screen.rows.filter((_, i) => screen.items[i] === "tool:f")
    expect(rows.every((row) => row.find((run) => run.text.includes("▎"))?.tone === "error")).toBe(true)
    expect(rows.flat().find((run) => run.text === "fatal: no")?.tone).toBe("error")
  })

  test("reads in a row are one list, with no blank lines between them", () => {
    const draw = run(
      ["a", "b", "c"].map(
        (name, i): Change => ({
          type: "tool",
          id: "c",
          call: name,
          name: "read",
          state: "completed",
          input: { filePath: `/w/${name}.ts` },
          at: at + i,
        }),
      ),
    )
    const rows = draw().rows.map(rowText)
    const first = rows.findIndex((row) => row.includes("a.ts"))
    expect(rows[first + 1]).toContain("→ Read w/b.ts")
    expect(rows[first + 2]).toContain("→ Read w/c.ts")
  })
})

describe("the paint cache", () => {
  test("a cached paint draws exactly what an uncached one does, through every change", async () => {
    const { nodes } = await model(1)
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const cache = createScreenCache()
    const call = screenRows(pane(session, nodes)).keys.find((key) => key.startsWith("tool:")) as string
    for (const state of [
      {},
      { top: 0 },
      { open: new Set([call]) },
      { selected: call, top: 0 },
      { thinking: true },
      { width: 90 },
      { frame: 7 },
      {},
    ]) {
      const plain = screenRows({ ...pane(session, nodes), ...state })
      const cached = screenRows({ ...pane(session, nodes), ...state, cache })
      expect(cached.rows).toEqual(plain.rows)
      expect(cached.items).toEqual(plain.items)
    }
  })
})

describe("a big output", () => {
  const at = 4_000_000
  const file = Array.from({ length: 2500 }, (_, i) => `row ${i + 1}`).join("\n")
  const m = applyAll(emptyModel(), [
    { type: "session", id: "c", parentID: "p", agent: "general", title: "Read", at },
    {
      type: "tool",
      id: "c",
      call: "r",
      name: "read",
      state: "completed",
      input: { filePath: "/w/big.ts" },
      output: file,
      at,
    },
    {
      type: "tool",
      id: "c",
      call: "s",
      name: "read",
      state: "completed",
      input: { filePath: "/w/small.ts" },
      at: at + 1,
    },
    { type: "status", id: "c", status: "idle", at: at + 2 },
  ])
  const nodes = subagentsOf(m, "p")
  const session = nodes[0]?.session as Session
  const base = {
    ...pane(session, nodes),
    width: 90,
    height: 30,
    selected: "tool:r",
    open: new Set(["tool:r"]),
  }

  test("open shows its first sixty lines and offers the rest; whole shows up to two thousand", () => {
    const open = screenRows({ ...base, height: 200, top: 0 })
      .rows.map(rowText)
      .join("\n")
    expect(open).toContain("row 60")
    expect(open).not.toContain("row 61 ")
    expect(open).toContain("… 2,440 more lines")
    expect(open).toContain("[a] show all")
    const whole = screenRows({ ...base, height: 2200, top: 0, whole: new Set(["tool:r"]) })
    const text = whole.rows.map(rowText).join("\n")
    expect(text).toContain("row 2000")
    expect(text).toContain("… 500 more lines")
  })

  test("scrolling inside the selected call stays where you scrolled", () => {
    const screen = screenRows({ ...base, top: 40 })
    expect(screen.top).toBe(40)
    const revealed = screenRows({ ...base, top: 40, reveal: true })
    expect(revealed.top).toBeLessThan(40)
  })
})
