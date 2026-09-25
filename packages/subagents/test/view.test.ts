import { describe, expect, test } from "bun:test"
import { createV1Translator } from "../src/core/adapt/v1.ts"
import { createV2Translator } from "../src/core/adapt/v2.ts"
import type { Change } from "../src/core/model/changes.ts"
import { applyAll, emptyModel, subagentsOf } from "../src/core/model/model.ts"
import { cut, elapsed, fit, rowText, widthOf, wrap } from "../src/core/view/rows.ts"
import { rowWidth, screenRows } from "../src/core/view/screen.ts"
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
      expect(rowText(lines[0]?.row ?? [])).toMatch(/^Subagents {2}1 · 1 done/)
      expect(rowText(lines[1]?.row ?? [])).toContain("explore")
      expect(rowText(lines[2]?.row ?? [])).toMatch(/done · \d+ tools/)
    })

    test("the full screen: exactly its height, every row exactly its width", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      for (const [width, height] of [
        [40, 12],
        [90, 30],
        [170, 40],
      ] as const) {
        for (const thinking of [true, false]) {
          const { rows } = screenRows({
            session,
            nodes,
            width,
            height,
            now: Date.now(),
            frame: 0,
            up: 0,
            thinking,
            expanded: false,
          })
          expect(rows).toHaveLength(height)
          for (const row of rows) expect(rowWidth(row)).toBe(width)
        }
      }
    })

    test("the full screen shows the task, the calls and the answer", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const { rows } = screenRows({
        session,
        nodes,
        width: 140,
        height: 200,
        now: Date.now(),
        frame: 0,
        up: 0,
        thinking: true,
        expanded: true,
        launcher: "build",
      })
      const text = rows.map(rowText).join("\n")
      expect(text).toContain("EXPLORE")
      expect(text).toContain("launched by build")
      expect(text).toContain("Task")
      expect(text).toMatch(/✓ read +src\/(session|middleware)\.ts/)
      expect(text).toContain("Thinking")
      expect(text).toContain("createSession")
      expect(text).toContain("[m] Message")
    })

    test("scrolling up shows earlier rows, and stops at the start", async () => {
      const { nodes } = await model(version)
      const session = nodes[0]?.session
      if (!session) throw new Error("no subagent")
      const base = {
        session,
        nodes,
        width: 80,
        height: 14,
        now: Date.now(),
        frame: 0,
        thinking: true,
        expanded: true,
      }
      const bottom = screenRows({ ...base, up: 0 })
      const far = screenRows({ ...base, up: 10_000 })
      expect(bottom.most).toBeGreaterThan(0)
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

  test("the sidebar says the call and how long it has run", () => {
    const m = applyAll(emptyModel(), running)
    const lines = sidebarLines({ nodes: subagentsOf(m, "p"), width: 40, now: at + 72_000, frame: 1 })
    const second = rowText(lines[2]?.row ?? [])
    expect(second).toContain("bash pnpm gen:types")
    expect(second.trimEnd()).toMatch(/1m12s$/)
  })

  test("the full screen streams the running call's output", () => {
    const m = applyAll(emptyModel(), running)
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const text = screenRows({
      session,
      nodes,
      width: 80,
      height: 20,
      now: at + 4000,
      frame: 0,
      up: 0,
      thinking: true,
      expanded: false,
    })
      .rows.map(rowText)
      .join("\n")
    expect(text).toContain("running 4s")
    expect(text).toContain("│ wrote 12 files")
  })

  test("a long run of finished calls folds, and [e] shows them all", () => {
    const calls: Change[] = Array.from(
      { length: 14 },
      (_, i) =>
        ({
          type: "tool",
          id: "c",
          call: `r${i}`,
          name: "read",
          state: "completed",
          input: { filePath: `/w/src/f${i}.ts` },
          at: at + i,
        }) as Change,
    )
    const m = applyAll(emptyModel(), [...running.slice(0, 3), ...calls])
    const nodes = subagentsOf(m, "p")
    const session = nodes[0]?.session
    if (!session) throw new Error("no subagent")
    const base = { session, nodes, width: 80, height: 60, now: at, frame: 0, up: 0, thinking: true }
    const folded = screenRows({ ...base, expanded: false })
      .rows.map(rowText)
      .join("\n")
    expect(folded).toContain("9 earlier calls")
    expect(folded).not.toContain("src/f0.ts")
    expect(folded).toContain("src/f13.ts")
    const all = screenRows({ ...base, expanded: true })
      .rows.map(rowText)
      .join("\n")
    expect(all).toContain("src/f0.ts")
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
