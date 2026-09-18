import { describe, expect, test } from "bun:test"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import {
  displayCommand,
  kindOf,
  order,
  partition,
  relativeCwd,
  statusDetail,
  wrapText,
} from "../src/tui/lib/view.ts"

let seq = 0
const shell = (over: Partial<ShellInfo>): ShellInfo => ({
  id: `sh_${String(seq++).padStart(8, "a")}`,
  title: "t",
  command: "/bin/zsh",
  args: ["-c", "npm test"],
  cwd: "/p",
  owner: { project: "/p" },
  status: "running",
  run: 1,
  startedAt: 1000,
  cols: 80,
  rows: 24,
  lines: { first: 1, last: 0 },
  bytes: 0,
  ...over,
})

const MIN = 60_000

describe("status kinds", () => {
  test("derive from status and exit code", () => {
    expect(kindOf(shell({}))).toBe("run")
    expect(kindOf(shell({ status: "exited", exitCode: 0 }))).toBe("done")
    expect(kindOf(shell({ status: "exited", exitCode: 2 }))).toBe("fail")
    expect(kindOf(shell({ status: "failed" }))).toBe("fail")
    expect(kindOf(shell({ status: "killed", signal: "SIGTERM" }))).toBe("stop")
  })

  test("details read naturally", () => {
    const now = 10 * MIN
    expect(statusDetail(shell({ startedAt: now - 90_000 }), now)).toBe("1m30s")
    expect(statusDetail(shell({ status: "exited", exitCode: 1, startedAt: 0, endedAt: 41_000 }), now)).toBe(
      "exit 1 after 41s · 9m ago",
    )
    expect(statusDetail(shell({ status: "failed" }), now)).toBe("could not start")
  })
})

describe("ordering and history", () => {
  const now = 100 * MIN
  const run2 = shell({ startedAt: 50 })
  const run1 = shell({ startedAt: 10 })
  const oldFail = shell({ status: "exited", exitCode: 1, endedAt: now - 60 * MIN })
  const newFail = shell({ status: "exited", exitCode: 1, endedAt: now - MIN })
  const done = shell({ status: "exited", exitCode: 0, endedAt: now - MIN })
  const stopped = shell({ status: "killed", endedAt: now - 2 * MIN })
  const all = [done, oldFail, run2, stopped, newFail, run1]

  test("running first, then failures, stopped, done", () => {
    expect(order(all).map((s) => s.id)).toEqual(
      [run1, run2, newFail, oldFail, stopped, done].map((s) => s.id),
    )
  })

  test("default view keeps running and recent failures; the rest folds", () => {
    const { visible, hidden } = partition(all, { showAll: false, historyMs: 30 * MIN, now })
    expect(visible.map((s) => s.id)).toEqual([run1.id, run2.id, newFail.id])
    expect(hidden).toHaveLength(3)
  })

  test("selection stays visible; showAll shows everything", () => {
    expect(partition(all, { showAll: false, historyMs: 30 * MIN, now, keep: done.id }).visible).toContain(
      done,
    )
    expect(partition(all, { showAll: true, historyMs: 30 * MIN, now }).visible).toHaveLength(6)
  })
})

describe("command display", () => {
  test("unwraps $SHELL -c", () => {
    expect(displayCommand(shell({}))).toBe("npm test")
    expect(displayCommand(shell({ command: "node", args: ["server.js"] }))).toBe("node server.js")
  })

  test("relative folders", () => {
    expect(relativeCwd("/p", "/p")).toBe("")
    expect(relativeCwd("/p/packages/api/", "/p")).toBe("./packages/api")
    expect(relativeCwd("/Users/me/other", "/p", "/Users/me")).toBe("~/other")
    expect(relativeCwd("/opt/x", "/p", "/Users/me")).toBe("/opt/x")
  })

  test("wraps to a line budget with an ellipsis", () => {
    expect(wrapText("abcdefghij", 4, 3)).toEqual(["abcd", "efgh", "ij"])
    expect(wrapText("abcdefghijklmnop", 4, 2)).toEqual(["abcd", "efg…"])
    expect(wrapText("a\nb", 10, 2)).toEqual(["a ⏎ b"])
  })
})
