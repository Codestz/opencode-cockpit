import { describe, expect, test } from "bun:test"
import { slim } from "../src/agent/plugin.ts"
import type { Change } from "../src/core/model/changes.ts"
import { applyAll, emptyModel, type Model, ORPHANED, subagentsOf } from "../src/core/model/model.ts"
import { stateOf as reportState, subagentReport } from "../src/core/view/report.ts"
import { rowText } from "../src/core/view/rows.ts"
import { screenRows } from "../src/core/view/screen.ts"
import { runPhrase, sidebarLines, stateOf } from "../src/core/view/sidebar.ts"

/**
 * A subagent cancelled with subagents of its own still running: OpenCode tells us the parent ended,
 * not always the children, and they spun on under a stopped parent — in the sidebar, the pane and
 * subagents_list alike. What it launched settles as stopped with it, until it says otherwise.
 */

const NOW = 1_790_000_000_000

/** build → planner → (advisor → helper), with a finished scout beside the advisor. */
function tree(): Change[] {
  const at = NOW - 60_000
  const run = (id: string, parentID: string, title: string): Change[] => [
    { type: "session", id, parentID, agent: "general", title, at },
    { type: "prompt", id, key: `${id}:p`, text: title, at },
    { type: "status", id, status: "busy", at },
    { type: "tool", id, call: `${id}:1`, name: "read", state: "running", input: { filePath: "/a.ts" }, at },
  ]
  return [
    { type: "session", id: "root", agent: "build", title: "Build", at },
    ...run("planner", "root", "Plan it"),
    ...run("advisor", "planner", "Advise"),
    ...run("helper", "advisor", "Help"),
    ...run("scout", "planner", "Scout"),
    { type: "status", id: "scout", status: "idle", at: at + 5_000 },
  ]
}

const cancel = (id: string, at = NOW - 10_000): Change => ({
  type: "status",
  id,
  status: "failed",
  error: "MessageAbortedError",
  at,
})

const sessionOf = (model: Model, id: string) => {
  const found = model.sessions.get(id)
  if (!found) throw new Error(id)
  return found
}

describe("a cancelled subagent takes down what it launched", () => {
  test("its running children and theirs settle as stopped; what had finished stays done", () => {
    const model = applyAll(emptyModel(), [...tree(), cancel("planner")])
    for (const id of ["advisor", "helper"]) {
      const s = sessionOf(model, id)
      expect(stateOf(s)).toBe("stopped")
      expect(s.error).toBe(ORPHANED)
      expect(s.ended).toBe(NOW - 10_000)
      /** No call left spinning inside it either. */
      expect(s.entries.some((entry) => entry.kind === "tool" && entry.state === "running")).toBe(false)
    }
    expect(stateOf(sessionOf(model, "scout"))).toBe("done")
  })

  test("a failure takes them down too, not only a stop", () => {
    const model = applyAll(emptyModel(), [
      ...tree(),
      { type: "status", id: "planner", status: "failed", error: "rate limited", at: NOW - 10_000 },
    ])
    expect(stateOf(sessionOf(model, "planner"))).toBe("failed")
    expect(stateOf(sessionOf(model, "advisor"))).toBe("stopped")
  })

  test("one that finished does not: a background child outlives its parent", () => {
    const model = applyAll(emptyModel(), [
      ...tree(),
      { type: "status", id: "planner", status: "idle", at: NOW - 10_000 },
    ])
    expect(stateOf(sessionOf(model, "advisor"))).toBe("running")
  })

  test("the conversation's own end is not a subagent's", () => {
    const model = applyAll(emptyModel(), [...tree(), cancel("root")])
    expect(stateOf(sessionOf(model, "planner"))).toBe("running")
  })

  test("anything it does afterwards brings it back; something from before does not", () => {
    const model = applyAll(emptyModel(), [...tree(), cancel("planner")])
    applyAll(model, [
      { type: "tool", id: "helper", call: "helper:0", name: "read", state: "completed", at: NOW - 20_000 },
    ])
    expect(stateOf(sessionOf(model, "helper"))).toBe("stopped")
    applyAll(model, [{ type: "reply", id: "advisor", key: "r", delta: "Still here", at: NOW - 5_000 }])
    const advisor = sessionOf(model, "advisor")
    expect(stateOf(advisor)).toBe("running")
    expect(advisor.error).toBeUndefined()
    expect(advisor.ended).toBeUndefined()
  })

  test("its own word wins: busy is running, idle is done, its own abort is stopped", () => {
    const model = applyAll(emptyModel(), [...tree(), cancel("planner")])
    applyAll(model, [
      { type: "status", id: "advisor", status: "busy", at: NOW - 5_000 },
      { type: "status", id: "helper", status: "idle", at: NOW - 5_000 },
    ])
    expect(stateOf(sessionOf(model, "advisor"))).toBe("running")
    expect(stateOf(sessionOf(model, "helper"))).toBe("done")
    expect(sessionOf(model, "helper").error).toBeUndefined()

    const again = applyAll(emptyModel(), [...tree(), cancel("planner"), cancel("helper", NOW - 9_000)])
    const helper = sessionOf(again, "helper")
    expect(stateOf(helper)).toBe("stopped")
    expect(helper.orphaned).toBeUndefined()
  })

  test("the sidebar, the pane and the tools say the same of it", () => {
    const changes = [...tree(), cancel("planner")]
    const ui = applyAll(emptyModel(), changes)
    const agent = applyAll(emptyModel(), slim(changes))
    const nodes = subagentsOf(ui, "root")

    const sidebar = sidebarLines({ nodes, width: 60, now: NOW, frame: 0, limit: 10 })
    expect(rowText(sidebar[0]?.row ?? [])).toContain("3 stopped")
    expect(rowText(sidebar[0]?.row ?? [])).not.toContain("running")

    const advisor = sessionOf(ui, "advisor")
    const phrase = runPhrase(advisor, NOW)
    expect(phrase).toStartWith("stopped after")
    const pane = screenRows({
      session: advisor,
      nodes,
      width: 100,
      height: 30,
      now: NOW,
      frame: 0,
      open: new Set(),
      closed: new Set(),
      thinking: false,
      details: false,
    })
      .rows.slice(0, 1)
      .map(rowText)
      .join("")
    expect(pane).toContain(phrase)

    const kept = sessionOf(agent, "advisor")
    expect(runPhrase(kept, NOW)).toBe(phrase)
    const state = reportState(kept, NOW)
    expect(state.kind).toBe("cancelled")
    expect(state.over).toBe(true)
    expect(state.text).toContain("taken as stopped when the subagent that launched it ended")
    const list = subagentReport({ nodes: subagentsOf(agent, "root"), now: NOW, version: 1 })
    expect(list).toContain(`- advisor · general · "Advise" · ${phrase}`)
  })
})
