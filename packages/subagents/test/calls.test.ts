import { describe, expect, test } from "bun:test"
import type { Change } from "../src/core/model/changes.ts"
import { applyAll, emptyModel, type Session, subagentsOf } from "../src/core/model/model.ts"
import { CALLS_ROOT, CALLS_SERVERS, callsSample, SAMPLE_NOW } from "../src/core/sample.ts"
import { argumentRows, headOf } from "../src/core/view/args.ts"
import { inline, markdownRows, plain } from "../src/core/view/markdown.ts"
import { rowText } from "../src/core/view/rows.ts"
import { rowWidth, type ScreenInput, screenRows } from "../src/core/view/screen.ts"
import { rendererOf, targetOf, todosOf } from "../src/core/view/tools.ts"

/**
 * Calls of every kind, drawn (issue #32): arguments climb the same ladder as output, are drawn by
 * type, and every kind of call comes from one table.
 */

const model = applyAll(emptyModel(), callsSample())
const nodes = subagentsOf(model, CALLS_ROOT)
const advise = nodes.find((node) => node.session.id === "ses_advise")?.session as Session

const pane = (more: Partial<ScreenInput> = {}): ScreenInput => ({
  session: advise,
  nodes,
  launcher: "build",
  width: 100,
  height: 400,
  now: SAMPLE_NOW,
  frame: 0,
  top: 0,
  open: new Set(),
  closed: new Set(),
  thinking: false,
  details: false,
  servers: CALLS_SERVERS,
  ...more,
})

/** One item's rows, as text with the padding taken off. */
const itemText = (input: ScreenInput, key: string): string[] => {
  const screen = screenRows(input)
  return screen.rows.filter((_, i) => screen.items[i] === key).map((row) => rowText(row).trimEnd())
}

describe("a long argument climbs the ladder (#32)", () => {
  const key = "tool:a4"

  test("folded: three rows of the question, what it hid, and that it opens", () => {
    const rows = itemText(pane(), key)
    expect(rows.some((row) => row.includes("question"))).toBe(true)
    expect(rows.some((row) => row.includes("I'm reviewing"))).toBe(true)
    expect(rows.some((row) => row.includes("What the code does today"))).toBe(false)
    expect(rows.some((row) => /… \d+ more lines/.test(row))).toBe(true)
    expect(rows.at(-2)).toContain("Click to expand")
  })

  test("open: far more of it, still saying what is left, and offering [a]", () => {
    const rows = itemText(pane({ open: new Set([key]), width: 60 }), key)
    expect(rows.some((row) => row.includes("What the code does today"))).toBe(true)
    expect(rows.some((row) => row.includes("Thanks!"))).toBe(false)
    expect(rows.some((row) => /… \d+ more lines/.test(row))).toBe(true)
    expect(rows.some((row) => row.includes("Click to collapse · [a] show all"))).toBe(true)
  })

  test("whole: all of it, nothing hidden, and no [a] left to offer", () => {
    const rows = itemText(pane({ open: new Set([key]), whole: new Set([key]) }), key)
    expect(rows.some((row) => row.includes("Thanks!"))).toBe(true)
    expect(rows.some((row) => /more lines?$/.test(row))).toBe(false)
    expect(rows.some((row) => row.endsWith("Click to collapse"))).toBe(true)
  })

  test("a call with a long argument and no output still says it opens", () => {
    const m = applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "general", title: "Ask", at: 1 },
      {
        type: "tool",
        id: "c",
        call: "q",
        name: "ask_advisor",
        state: "running",
        input: { question: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") },
        at: 1,
      },
    ])
    const list = subagentsOf(m, "p")
    const rows = itemText(pane({ session: list[0]?.session as Session, nodes: list }), "tool:q")
    expect(rows.some((row) => row.includes("… 37 more lines"))).toBe(true)
    expect(rows.some((row) => row.includes("Click to expand"))).toBe(true)
  })
})

describe("arguments, by type", () => {
  test("a short value is one row: its name, then the value", () => {
    const { rows } = argumentRows({ pattern: "loadConfig", limit: 20, all: true }, 60, 3, "markdown")
    expect(rows.map((row) => rowText(row).trimEnd())).toEqual([
      "pattern  loadConfig",
      "limit    20",
      "all      true",
    ])
  })

  test("a long string is markdown under its name", () => {
    const { rows } = argumentRows({ question: "## Ask\n\nIs **this** right?" }, 60, 20, "markdown")
    const text = rows.map((row) => rowText(row).trimEnd())
    expect(text[0]).toBe("question")
    expect(text).toContain("  Ask")
    expect(text).toContain("  Is this right?")
    expect(rows.flat().find((run) => run.text === "this")?.bold).toBe(true)
  })

  test("a file tool's long string stays exactly as written", () => {
    const { rows } = argumentRows({ content: "# not a heading\n- not a list" }, 60, 20, "verbatim")
    expect(rows.map((row) => rowText(row).trimEnd())).toEqual([
      "content",
      "  # not a heading",
      "  - not a list",
    ])
  })

  test("an object is indented JSON, not one squashed line", () => {
    const { rows } = argumentRows({ options: { tokens: 4000, topics: ["a", "b"] } }, 60, 20, "markdown")
    const text = rows.map((row) => rowText(row).trimEnd())
    expect(text).toContain('    "tokens": 4000,')
    expect(text).toContain('      "a",')
    expect(text.some((row) => row.includes('{"tokens"'))).toBe(false)
  })

  test("every row is exactly the width it was given", () => {
    for (const width of [20, 33, 60]) {
      const { rows } = argumentRows(
        { a: "x", question: "word ".repeat(80), options: { deep: { deeper: [1, 2, 3] } } },
        width,
        10,
        "markdown",
      )
      for (const row of rows) expect(rowWidth(row)).toBe(width)
    }
  })
})

describe("one table for every kind of call", () => {
  test("built-in tools", () => {
    expect(rendererOf("bash").kind).toBe("shell")
    expect(rendererOf("apply_patch")).toMatchObject({ kind: "file", title: "Patch" })
    expect(rendererOf("read")).toMatchObject({ kind: "quiet", title: "Read" })
    expect(rendererOf("grep").kind).toBe("quiet")
    expect(rendererOf("task").kind).toBe("task")
    expect(rendererOf("todowrite").kind).toBe("todos")
    expect(rendererOf("websearch")).toMatchObject({ kind: "web", title: "WebSearch" })
  })

  test("an MCP tool is server · tool only for a server we know; anything else keeps its name", () => {
    expect(rendererOf("context7_query-docs", ["context7"])).toMatchObject({
      kind: "generic",
      title: "context7 · query-docs",
    })
    expect(rendererOf("context7_query-docs").title).toBe("context7_query-docs")
    expect(rendererOf("ask_advisor", ["context7"])).toMatchObject({ kind: "generic", title: "ask_advisor" })
    expect(rendererOf("my_server_tool", ["my.server"]).title).toBe("my.server · tool")
  })

  test("targets: a URL, a query in quotes, the subagent and what it was asked", () => {
    expect(targetOf("webfetch", "web", { url: "https://x.dev" })).toBe("https://x.dev")
    expect(targetOf("websearch", "web", { query: "bun test" })).toBe('"bun test"')
    expect(targetOf("task", "task", { description: "Scan", subagent_type: "explore" })).toBe("explore · Scan")
    expect(targetOf("ask_advisor", "generic", { question: "long\nquestion" })).toBe("")
  })

  test("todos from what it was given, or from what todoread answered", () => {
    expect(todosOf({ todos: [{ content: "a", status: "completed" }] }, "")).toEqual([
      { content: "a", status: "completed" },
    ])
    expect(todosOf({}, '[{"content":"b","status":"pending"}]')).toEqual([{ content: "b", status: "pending" }])
    expect(todosOf({}, "not json")).toBeUndefined()
  })
})

describe("each kind, drawn", () => {
  test("a todo list is a checklist, with how far along it is", () => {
    const rows = itemText(pane(), "tool:a1")
    expect(rows[0]).toContain("☐ Todos 2/5 done")
    expect(rows).toContain("     [✓] Read the refresh plan")
    expect(rows).toContain("     [•] Check the middleware for a refresh race")
    expect(rows).toContain("     [ ] Write up the review")
  })

  test("an MCP tool is titled by its server, and its object argument is indented JSON", () => {
    const rows = itemText(pane(), "tool:a2")
    expect(rows.some((row) => row.includes("⚙ context7 · query-docs /panva/jose"))).toBe(true)
    expect(rows.some((row) => row.includes('"tokens": 4000,'))).toBe(true)
  })

  test("a task names the subagent it launched, and enter goes there", () => {
    const screen = screenRows(pane())
    expect(screen.links.get("tool:a3")).toBe("ses_scan")
    const rows = itemText(pane(), "tool:a3")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("◉ Task explore · Scan for token refresh callers")
    expect(rows[0]).not.toContain("(@explore subagent)")
    expect(rows[0]).toMatch(/›$/)
  })

  test("a task whose subagent cannot be told links nowhere", () => {
    const m = applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "general", title: "Lead", at: 1 },
      { type: "session", id: "d", parentID: "c", agent: "explore", title: "Something else", at: 2 },
      {
        type: "tool",
        id: "c",
        call: "t",
        name: "task",
        state: "completed",
        input: { description: "Scan" },
        at: 2,
      },
    ])
    const list = subagentsOf(m, "p")
    const screen = screenRows(pane({ session: list[0]?.session as Session, nodes: list }))
    expect(screen.links.size).toBe(0)
  })

  test("a generic call with short arguments stays one line until opened", () => {
    const m = applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "general", title: "Lead", at: 1 },
      {
        type: "tool",
        id: "c",
        call: "x",
        name: "lookup",
        state: "completed",
        input: { id: "42" },
        output: "ok",
        at: 2,
      },
    ])
    const list = subagentsOf(m, "p")
    const base = pane({ session: list[0]?.session as Session, nodes: list })
    expect(itemText(base, "tool:x")).toEqual(["   ⚙ lookup 42"])
    expect(
      itemText({ ...base, open: new Set(["tool:x"]) }, "tool:x").some((row) => row.includes("id  42")),
    ).toBe(true)
  })
})

describe("thinking, as markdown", () => {
  test("open: a heading, bold, a list and a tsx fence drawn, not shown as source", () => {
    const rows = itemText(pane({ thinking: true }), "thinking:r1")
    const text = rows.join("\n")
    expect(text).not.toContain("```")
    expect(text).not.toContain("**")
    expect(text).not.toMatch(/^ *# /m)
    expect(text).toContain("• list the callers of refreshToken")
    expect(rows.some((row) => row.includes("│ export function SessionBadge") && row.endsWith("tsx"))).toBe(
      true,
    )
    const screen = screenRows(pane({ thinking: true }))
    const runs = screen.rows
      .filter((_, i) => screen.items[i] === "thinking:r1")
      .slice(1)
      .flat()
    expect(runs.filter((run) => run.text.trim()).every((run) => run.tone === "muted" && run.faint)).toBe(true)
  })

  test("folded: one line of plain words", () => {
    const [row] = itemText(pane(), "thinking:r1")
    expect(row).toContain("◇ Thought")
    expect(row).toContain("Plan The refresh logic is the risky part.")
    expect(row).not.toMatch(/[#*`]/)
  })

  test("a fence still being written draws as code", () => {
    const m = applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "general", title: "Lead", at: 1 },
      { type: "thinking", id: "c", key: "k", text: "Try this:\n```ts\nconst a = 1", at: 1 },
    ])
    const list = subagentsOf(m, "p")
    const rows = itemText(
      pane({ session: list[0]?.session as Session, nodes: list, thinking: true }),
      "thinking:k",
    )
    expect(rows.some((row) => row.includes("│ const a = 1") && row.endsWith("ts"))).toBe(true)
    expect(rows.join("\n")).not.toContain("```")
  })

  test("plain takes the markup out", () => {
    expect(plain("# Head\n\n- **bold** and `code`\n```ts\nx()\n```\n> quoted [link](http://x)")).toBe(
      "Head bold and code x() quoted link http://x",
    )
  })
})

describe("markdown, inline", () => {
  const pieces = (text: string) => inline(text, { tone: "text" })

  test("emphasis is faint (italic in the pane); snake_case and a * b are not emphasis", () => {
    expect(pieces("an *em* word").find((run) => run.text === "em")?.faint).toBe(true)
    expect(pieces("an _em_ word").find((run) => run.text === "em")?.faint).toBe(true)
    expect(pieces("snake_case_name").map((run) => run.text)).toEqual(["snake_case_name"])
    expect(pieces("a * b * c").map((run) => run.text)).toEqual(["a * b * c"])
  })

  test("a link shows its words, then where it goes, muted", () => {
    const runs = pieces("see [the RFC](https://x.dev/42) now")
    expect(runs.map((run) => run.text)).toEqual(["see ", "the RFC", " https://x.dev/42", " now"])
    expect(runs[2]?.tone).toBe("muted")
  })

  test("a strike is muted and faint — there is no strikethrough to draw", () => {
    const run = pieces("~~gone~~").find((each) => each.text === "gone")
    expect(run).toMatchObject({ tone: "muted", faint: true })
  })

  test("nothing inside a code span is markup", () => {
    expect(pieces("`*not em*`")).toEqual([{ tone: "tool", text: "*not em*" }])
  })

  test("a fence names its language on its first row, and a list item continues indented", () => {
    const rows = markdownRows("```tsx\nconst a = 1\n```\n\n1. first part\n   second part", 40, {
      indent: 0,
    }).map((row) => rowText(row).trimEnd())
    expect(rows[0]).toMatch(/^│ const a = 1 +tsx$/)
    expect(rows).toContain("   second part")
    for (const row of markdownRows("```tsx\nconst a = 1\n```", 40, { indent: 0 }))
      expect(rowWidth(row)).toBe(40)
  })
})

describe("the grid, with every kind of call", () => {
  test("exactly its height, every row exactly its width — folded, open and whole", () => {
    const keys = screenRows(pane()).keys
    const calls = keys.filter((key) => key.startsWith("tool:"))
    for (const width of [24, 34, 42, 60, 90, 140]) {
      for (const state of [
        {},
        { open: new Set(keys) },
        { open: new Set(keys), whole: new Set(calls), thinking: true },
      ]) {
        for (const height of [12, 400]) {
          const screen = screenRows(pane({ ...state, width, height }))
          expect(screen.rows).toHaveLength(height)
          for (const row of screen.rows) expect(rowWidth(row)).toBe(width)
        }
      }
    }
  })
})

describe("a huge argument stays cheap", () => {
  const huge = Array.from(
    { length: 100_000 },
    (_, i) => `line ${i} of a very long question about **things**`,
  ).join("\n")
  const changes: Change[] = [
    { type: "session", id: "c", parentID: "p", agent: "general", title: "Ask", at: 1 },
    {
      type: "tool",
      id: "c",
      call: "q",
      name: "ask_advisor",
      state: "completed",
      input: { question: huge, blob: "x".repeat(2_000_000) },
      output: "ok",
      at: 1,
    },
  ]
  const m = applyAll(emptyModel(), changes)
  const list = subagentsOf(m, "p")
  const base = pane({ session: list[0]?.session as Session, nodes: list, height: 3000 })

  test("the cut reads only what it can show", () => {
    const { head, rest } = headOf(huge, 3, 80)
    expect(head.split("\n").length).toBeLessThanOrEqual(10)
    expect(rest).toBeGreaterThan(99_000)
  })

  test("folded, open and whole each draw in a few milliseconds", () => {
    for (const state of [
      {},
      { open: new Set(["tool:q"]) },
      { open: new Set(["tool:q"]), whole: new Set(["tool:q"]) },
    ]) {
      const started = performance.now()
      const screen = screenRows({ ...base, ...state })
      const took = performance.now() - started
      expect(took).toBeLessThan(250)
      expect(screen.rows.map(rowText).join("\n")).toMatch(/… [\d,]+ more lines/)
    }
  })
})
