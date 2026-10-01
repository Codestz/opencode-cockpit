import { describe, expect, test } from "bun:test"
import type { Change } from "../src/core/model/changes.ts"
import { applyAll, emptyModel, groupsOf, type Model, subagentsOf } from "../src/core/model/model.ts"
import {
  ADVISOR_ROOT,
  advisorSample,
  LATE_ROOT,
  lateSample,
  SAMPLE_NOW,
  SAMPLE_ROOT,
  sample,
} from "../src/core/sample.ts"
import { rowText } from "../src/core/view/rows.ts"
import { rowWidth } from "../src/core/view/screen.ts"
import { type SidebarInput, sidebarLines } from "../src/core/view/sidebar.ts"

/**
 * The sidebar's order and its nesting: working first, children under their parent, an advisor asked
 * six times as one entry, and finished nested ones leaving after a while. All pure — `now` is passed.
 */

const ids = (m: Model, root: string) => subagentsOf(m, root).map((node) => [node.session.id, node.depth])
const text = (input: SidebarInput) => sidebarLines(input).map((line) => rowText(line.row).trimEnd())
const heading = (input: SidebarInput) => text(input)[0] ?? ""

/** A subagent launched, working, and — given an end — finished. */
const sub = (
  id: string,
  parentID: string,
  at: number,
  end?: number,
  title = id,
  agent = "general",
): Change[] => [
  { type: "session", id, parentID, agent, title, at },
  { type: "status", id, status: "busy", at },
  ...(end === undefined ? [] : [{ type: "status", id, status: "idle", at: end } as Change]),
]

describe("order", () => {
  test("a late subagent still running sits above the ones that finished", () => {
    const m = applyAll(emptyModel(), lateSample())
    expect(ids(m, LATE_ROOT)).toEqual([
      /** Finished, but what it launched is still working: the pair moves up together. */
      ["ses_l_docs", 0],
      ["ses_l_bg", 1],
      ["ses_l_tests", 0],
      ["ses_l_map", 0],
      ["ses_l_types", 0],
      ["ses_l_bench", 0],
    ])
    const lines = text({ nodes: subagentsOf(m, LATE_ROOT), width: 40, now: SAMPLE_NOW, frame: 0 })
    expect(lines[1]).toContain("Document the middleware")
    expect(lines[3]).toMatch(/^ {2}\S explore Collect examples/)
    expect(lines[5]).toContain("Fix the flaky refresh test")
  })

  test("rows move on a status change, and on nothing else", () => {
    const m = applyAll(emptyModel(), [...sub("a", "p", 1), ...sub("b", "p", 2), ...sub("c", "p", 3)])
    expect(ids(m, "p").map(([id]) => id)).toEqual(["a", "b", "c"])
    /** Busy work in the last one — calls, thinking, usage — does not lift it. */
    applyAll(m, [
      { type: "tool", id: "c", call: "1", name: "read", state: "running", input: {}, at: 10 },
      { type: "thinking", id: "c", key: "r", delta: "hmm", at: 11 },
      { type: "usage", id: "c", tokens: 900, at: 12 },
    ])
    expect(ids(m, "p").map(([id]) => id)).toEqual(["a", "b", "c"])
    /** The first one finishing drops it below the working ones. */
    applyAll(m, [{ type: "status", id: "a", status: "idle", at: 13 }])
    expect(ids(m, "p").map(([id]) => id)).toEqual(["b", "c", "a"])
    /** Working again, it goes back where its start puts it. */
    applyAll(m, [{ type: "status", id: "a", status: "busy", at: 14 }])
    expect(ids(m, "p").map(([id]) => id)).toEqual(["a", "b", "c"])
  })

  test("two that started together keep one order", () => {
    const m = applyAll(emptyModel(), [...sub("y", "p", 5), ...sub("x", "p", 5)])
    expect(ids(m, "p").map(([id]) => id)).toEqual(["x", "y"])
  })

  test("children stay directly under their parent, whatever their state", () => {
    const m = applyAll(emptyModel(), [
      ...sub("a", "p", 1, 9),
      ...sub("a1", "a", 2, 4),
      ...sub("b", "p", 3),
      ...sub("b1", "b", 4, 6),
      ...sub("b2", "b", 5),
    ])
    expect(ids(m, "p")).toEqual([
      ["b", 0],
      ["b2", 1],
      ["b1", 1],
      ["a", 0],
      ["a1", 1],
    ])
  })
})

describe("an advisor asked again and again", () => {
  const m = applyAll(emptyModel(), advisorSample())
  const nodes = subagentsOf(m, ADVISOR_ROOT)

  test("is one entry with a count, under the subagent that asks it", () => {
    const groups = groupsOf(nodes)
    expect(groups.map((group) => group.lead.id)).toEqual(["ses_planner", "ses_scout"])
    const advisor = groups[0]?.children[0]
    expect(advisor?.members.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `ses_advisor${n}`))
    expect(advisor?.depth).toBe(1)
    /** The newest one still at it is the one described, and the one a click opens. */
    expect(advisor?.lead.id).toBe("ses_advisor6")
    const lines = sidebarLines({ nodes, width: 40, now: SAMPLE_NOW, frame: 0 })
    const row = lines.findIndex((line) => rowText(line.row).includes("advisor"))
    expect(rowText(lines[row]?.row ?? []).trimEnd()).toMatch(/advisor Review the migration.* ×6$/)
    expect(rowText(lines[row + 1]?.row ?? [])).toContain("└ 2 running · read")
    expect(lines[row]?.id).toBe("ses_advisor6")
    expect(lines[row + 1]?.id).toBe("ses_advisor6")
  })

  test("the heading counts subagents, not entries: the planner and two advisors are running", () => {
    expect(heading({ nodes, width: 40, now: SAMPLE_NOW, frame: 0, fadeAfter: 30_000 })).toMatch(
      /^Subagents +3 running$/,
    )
  })

  test("all finished, the entry shows the latest, and the count stays", () => {
    const done = applyAll(emptyModel(), [
      ...sub("plan", "p", 1),
      ...sub("v1", "plan", 2, 3, "Check", "advisor"),
      ...sub("v2", "plan", 4, 5, "Check", "advisor"),
      ...sub("v3", "plan", 6, 7, "Check", "advisor"),
    ])
    const lines = sidebarLines({ nodes: subagentsOf(done, "p"), width: 40, now: 8, frame: 0 })
    expect(rowText(lines[3]?.row ?? []).trimEnd()).toMatch(/● advisor Check +×3$/)
    expect(lines[3]?.id).toBe("v3")
  })

  test("one held on a permission is the one shown, over one merely working", () => {
    const held = applyAll(emptyModel(), [
      ...sub("v1", "p", 1, undefined, "Check", "advisor"),
      { type: "status", id: "v1", status: "waiting", at: 2 },
      ...sub("v2", "p", 3, undefined, "Check", "advisor"),
    ])
    expect(groupsOf(subagentsOf(held, "p"))[0]?.lead.id).toBe("v1")
  })

  test("a different task, agent or parent is a different entry; untitled ones are never merged", () => {
    const m2 = applyAll(emptyModel(), [
      ...sub("a", "p", 1, undefined, "Check", "advisor"),
      ...sub("b", "p", 2, undefined, "Check again", "advisor"),
      ...sub("c", "p", 3, undefined, "Check", "general"),
      ...sub("d", "p", 4, undefined, "", "advisor"),
      ...sub("e", "p", 5, undefined, "", "advisor"),
    ])
    expect(groupsOf(subagentsOf(m2, "p")).map((group) => group.members.length)).toEqual([1, 1, 1, 1, 1])
  })

  test("rounds of one session and runs of several are told apart", () => {
    const m2 = applyAll(emptyModel(), [
      ...sub("a", "p", 1, undefined, "Check", "advisor"),
      { type: "prompt", id: "a", key: "u1", text: "Check", at: 1 },
      { type: "prompt", id: "a", key: "u2", text: "Check again", at: 2 },
    ])
    const lines = text({ nodes: subagentsOf(m2, "p"), width: 50, now: 3, frame: 0 })
    expect(lines[1]).not.toContain("×")
    expect(lines[2]).toContain("· 2 rounds")
  })
})

describe("finished nested subagents leave the sidebar", () => {
  /** A planner still working, with a helper that finished at 10s. */
  const changes = [...sub("plan", "p", 0), ...sub("help", "plan", 1_000, 10_000, "Help", "advisor")]
  const at = (now: number, fadeAfter?: number): SidebarInput => ({
    nodes: subagentsOf(applyAll(emptyModel(), changes), "p"),
    width: 40,
    now,
    frame: 0,
    ...(fadeAfter !== undefined ? { fadeAfter } : {}),
  })
  const shows = (input: SidebarInput) => text(input).some((line) => line.includes("advisor Help"))

  test("after the delay, not before", () => {
    expect(shows(at(10_000 + 29_999, 30_000))).toBe(true)
    expect(shows(at(10_000 + 30_000, 30_000))).toBe(false)
  })

  test("unset, they stay", () => {
    expect(shows(at(10_000 + 3_600_000))).toBe(true)
  })

  test("the heading still counts them, and they are not folded into '+ N more'", () => {
    const lines = text(at(60_000, 30_000))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/1 running$/)
    const all = applyAll(emptyModel(), [
      ...changes,
      { type: "status", id: "plan", status: "idle", at: 20_000 },
    ])
    expect(heading({ ...at(60_000, 30_000), nodes: subagentsOf(all, "p") })).toMatch(/2 done$/)
  })

  test("a top-level one never fades here", () => {
    const m = applyAll(emptyModel(), sub("solo", "p", 0, 1_000))
    expect(
      text({ nodes: subagentsOf(m, "p"), width: 40, now: 10_000_000, frame: 0, fadeAfter: 1 }),
    ).toHaveLength(3)
  })

  test("a group leaves only when every member has been done that long", () => {
    const m = applyAll(emptyModel(), [
      ...sub("plan", "p", 0),
      ...sub("v1", "plan", 1_000, 2_000, "Check", "advisor"),
      ...sub("v2", "plan", 3_000, 50_000, "Check", "advisor"),
    ])
    const input = (now: number) => ({
      nodes: subagentsOf(m, "p"),
      width: 40,
      now,
      frame: 0,
      fadeAfter: 30_000,
    })
    expect(text(input(60_000)).some((line) => line.includes("×2"))).toBe(true)
    expect(text(input(80_000)).some((line) => line.includes("advisor"))).toBe(false)
  })

  test("one with a child still working stays, and the child under it", () => {
    const m = applyAll(emptyModel(), [
      ...sub("plan", "p", 0),
      ...sub("mid", "plan", 1_000, 2_000, "Mid"),
      ...sub("deep", "mid", 1_500, undefined, "Deep"),
    ])
    const lines = text({ nodes: subagentsOf(m, "p"), width: 40, now: 99_000, frame: 0, fadeAfter: 30_000 })
    expect(lines.filter((line) => /general (Mid|Deep)/.test(line))).toHaveLength(2)
  })

  test("they stay reachable: the pane's list is still every subagent", () => {
    const m = applyAll(emptyModel(), advisorSample())
    expect(subagentsOf(m, ADVISOR_ROOT)).toHaveLength(9)
  })
})

describe("the limit", () => {
  test("working entries are shown before finished ones, and a shown child brings its parent", () => {
    const m = applyAll(emptyModel(), [
      ...sub("a", "p", 1, 2),
      ...sub("b", "p", 3, 4),
      ...sub("c", "p", 5, 6),
      ...sub("d", "p", 7, 8),
      ...sub("e", "d", 7_500),
    ])
    const lines = sidebarLines({ nodes: subagentsOf(m, "p"), width: 40, now: 9, frame: 0, limit: 1 })
    expect(lines.filter((line) => line.id).map((line) => line.id)).toEqual(["d", "d", "e", "e"])
    expect(rowText(lines.at(-1)?.row ?? []).trim()).toBe("+ 3 more")
  })
})

describe("the grid", () => {
  const fixtures = [
    { changes: sample, root: SAMPLE_ROOT },
    { changes: advisorSample, root: ADVISOR_ROOT },
    { changes: lateSample, root: LATE_ROOT },
  ]
  test("every row of every fixture is exactly the sidebar's width", () => {
    for (const { changes, root } of fixtures) {
      const nodes = subagentsOf(applyAll(emptyModel(), changes()), root)
      for (const width of [8, 12, 20, 26, 34, 42, 60, 90])
        for (const fadeAfter of [undefined, 30_000])
          for (const limit of [1, 3, 6]) {
            const lines = sidebarLines({
              nodes,
              width,
              now: SAMPLE_NOW,
              frame: 1,
              limit,
              ...(fadeAfter !== undefined ? { fadeAfter } : {}),
            })
            expect(lines.length).toBeGreaterThan(0)
            for (const line of lines) expect(rowWidth(line.row)).toBe(width)
          }
    }
  })
})
