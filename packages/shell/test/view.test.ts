import { describe, expect, test } from "bun:test"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import {
  consoleKeys,
  displayCommand,
  fitHints,
  footerHints,
  HINT_GAP,
  keyRows,
  kindOf,
  order,
  panelHints,
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

describe("the two tiers of keys", () => {
  const base = {
    shell: true,
    running: true,
    view: "log" as const,
    filtered: false,
    count: 2,
    scope: "session" as const,
    finished: 1,
  }

  /**
   * The footer was a wall of nine bracketed keys with no room for their words. What acts on the
   * shell in front of you stays; everything else is one press away, in a panel with room.
   */
  test("the footer carries what acts on this shell, and the way to the rest", () => {
    expect(footerHints(base).map((hint) => hint.key)).toEqual(["i", "c", "r", "x", "?"])
  })

  test("a finished shell has different actions and the same escape hatch", () => {
    expect(footerHints({ ...base, running: false }).map((hint) => hint.key)).toEqual(["r", "d", "?"])
  })

  test("with no shell there is nothing to move to, so nothing is hidden", () => {
    expect(footerHints({ ...base, shell: false }).map((hint) => hint.key)).toEqual(["n", "esc"])
    expect(panelHints({ ...base, shell: false })).toEqual([])
  })

  test("from the details panel the same key goes back", () => {
    const hint = footerHints({ ...base, view: "details" }).find((each) => each.key === "?")
    expect(hint?.label).toBe("Back")
  })

  /** Both halves come from one list, so the panel cannot drift out of step with the footer. */
  test("every key is in exactly one of the two", () => {
    const all = consoleKeys(base).map((hint) => hint.key)
    const split = [...footerHints(base), ...panelHints(base)]
      .map((hint) => hint.key)
      .filter((key) => key !== "?")
    expect(split.sort()).toEqual(all.sort())
  })

  /** Written out in full: alignment is the point, and a diff shows it better than an assertion. */
  test("the panel lays them out two to a line, aligned", () => {
    expect(keyRows(panelHints(base), 96)).toEqual([
      ["keys", "tab  Screen          /    Search Log"],
      ["", "[ ]  Switch Shell    s    Whole Project"],
      ["", "D    Clear Done      n    New Shell"],
      ["", "esc  Close"],
    ])
  })

  test("a narrow panel still lines the two columns up", () => {
    const rows = keyRows(panelHints(base), 40)
    const second = rows.filter((row) => row[1].includes("  ") && row[1].trimEnd().length > 18)
    expect(
      new Set(second.map((row) => row[1].indexOf(row[1].trimEnd().split(/ {2,}/)[1] as string))).size,
    ).toBe(1)
  })

  test("nothing to say means no rows at all", () => {
    expect(keyRows([], 96)).toEqual([])
  })
})

describe("the console's keys", () => {
  const base = {
    shell: true,
    running: true,
    view: "log" as const,
    filtered: false,
    count: 1,
    scope: "session" as const,
    finished: 0,
  }
  const keysOf = (over: Partial<typeof base> = {}) => consoleKeys({ ...base, ...over }).map((h) => h.key)

  test("with no shell selected there is almost nothing to offer", () => {
    expect(keysOf({ shell: false })).toEqual(["n", "esc"])
  })

  test("a running shell can be typed at, interrupted and stopped", () => {
    expect(keysOf()).toContain("i")
    expect(keysOf()).toContain("x")
  })

  /** Keys with no target are the thing this list exists to leave out. */
  test("a finished shell offers neither typing nor stopping", () => {
    const keys = keysOf({ running: false })
    expect(keys).not.toContain("i")
    expect(keys).not.toContain("x")
    expect(keys).toContain("d")
  })

  test("clearing a filter is offered only when one is on", () => {
    expect(keysOf({ filtered: true })).toContain("⌫")
    expect(keysOf({ filtered: false })).not.toContain("⌫")
  })

  test("switching shells is offered only when there is another one", () => {
    expect(keysOf({ count: 1 })).not.toContain("[ ]")
    expect(keysOf({ count: 2 })).toContain("[ ]")
  })

  test("clearing finished shells is offered only when some are finished", () => {
    expect(keysOf({ finished: 0 })).not.toContain("D")
    expect(keysOf({ finished: 2 })).toContain("D")
  })

  test("the scope key names where it would take you, not where you are", () => {
    const label = (scope: "session" | "project") =>
      consoleKeys({ ...base, scope }).find((hint) => hint.key === "s")?.label
    expect(label("session")).toBe("Whole Project")
    expect(label("project")).toBe("This Session")
  })

  test("details has no log to search", () => {
    expect(keysOf({ view: "details" })).not.toContain("/")
  })
})

describe("fitting the keys to the row", () => {
  const hints = [
    { key: "i", label: "Type" },
    { key: "c", label: "^C" },
    { key: "r", label: "Restart" },
  ]
  /** Exactly what the console prints, so the arithmetic can be checked against the string. */
  const printed = (cols: number) => {
    const row = fitHints(hints, cols)
    const text = row.hints
      .map((hint) => (hint.labelled ? `[${hint.key}] ${hint.label}` : `[${hint.key}]`))
      .join(" ".repeat(HINT_GAP))
    return row.dropped > 0 ? `${text} …` : text
  }

  test("a wide row keeps every word", () => {
    expect(printed(200)).toBe("[i] Type   [c] ^C   [r] Restart")
  })

  /**
   * The bug this replaced: one label too many and *every* label went, so a roomy console showed
   * `[r] [d] [tab] [/]` and said nothing at all.
   */
  test("the last label goes first, not all of them", () => {
    expect(printed(30)).toBe("[i] Type   [c] ^C   [r]")
    expect(printed(22)).toBe("[i] Type   [c]   [r]")
  })

  test("keys only drop once there are no labels left to drop", () => {
    expect(printed(15)).toBe("[i]   [c]   [r]")
    expect(printed(12)).toBe("[i]   [c] …")
  })

  /**
   * The row ran a key and a half off the edge because the gap was counted as two and printed as
   * three. What is measured has to be what is drawn.
   */
  test("what is printed never exceeds the room it was given", () => {
    for (let cols = 3; cols <= 60; cols++) expect(printed(cols).length).toBeLessThanOrEqual(cols)
  })

  test("a row that is not the whole list says so", () => {
    expect(fitHints(hints, 12).dropped).toBe(1)
    expect(fitHints(hints, 200).dropped).toBe(0)
  })
})
