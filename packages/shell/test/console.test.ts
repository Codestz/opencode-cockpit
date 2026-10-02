import { describe, expect, test } from "bun:test"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { type ConsoleInput, consoleRows } from "../src/tui/lib/console.ts"

/**
 * One console, two sizes. The dialog and full screen used to be two implementations and drifted
 * (full screen lost the `last output:` line, details and search); these pin them to one drawing.
 */

const shell: ShellInfo = {
  id: "sh_aaaaaaaa",
  title: "npm run test",
  command: "/bin/zsh",
  args: ["-c", "npm run test"],
  cwd: "/p",
  owner: { project: "/p" },
  status: "killed",
  signal: "SIGTERM",
  stopReason: "request",
  summary: "bun test v1.3.13",
  run: 1,
  startedAt: 1000,
  endedAt: 3000,
  cols: 80,
  rows: 24,
  lines: { first: 1, last: 40 },
  bytes: 0,
}
const output = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n")
const input = (over: Partial<ConsoleInput>): ConsoleInput => ({
  shell,
  now: 10_000,
  frame: 0,
  project: "/p",
  screen: { text: output, cols: 80, rows: 24, cursor: { x: 0, y: 0 } },
  log: [],
  view: "screen",
  up: 0,
  typing: false,
  colors: false,
  filter: "",
  searching: false,
  draft: "",
  keys: {
    shell: true,
    running: false,
    view: "screen",
    filtered: false,
    count: 1,
    scope: "session",
    finished: 1,
  },
  position: "",
  width: 116,
  height: 30,
  fill: false,
  ...over,
})
const text = (rows: { text: string }[][]) => rows.map((row) => row.map((run) => run.text).join(""))

describe("the console, at either size", () => {
  const dialog = text(consoleRows(input({})))
  const full = text(consoleRows(input({ width: 200, height: 56, fill: true })))

  test("says the same things in the dialog and over the whole window", () => {
    for (const said of [
      "STOP",
      "npm run test",
      "last output: bun test v1.3.13",
      "line 39",
      "[r] Run Again",
    ]) {
      expect(dialog.some((row) => row.includes(said))).toBe(true)
      expect(full.some((row) => row.includes(said))).toBe(true)
    }
  })

  test("full screen fills the window exactly; every row of both is as wide as its size", () => {
    expect(full).toHaveLength(56)
    for (const row of full) expect(row).toHaveLength(200)
    for (const row of dialog) expect(row).toHaveLength(116)
    expect(dialog.length).toBeLessThanOrEqual(30)
  })

  test("details and search are the same in both, too", () => {
    for (const size of [{}, { width: 200, height: 56, fill: true }]) {
      const details = text(consoleRows(input({ ...size, view: "details" })))
      expect(details.some((row) => row.includes("command"))).toBe(true)
      const searching = text(consoleRows(input({ ...size, view: "log", searching: true, draft: "err" })))
      expect(searching.at(-1)).toContain("search: err")
    }
  })

  test("scrolled up shows what came before, and says how to get back", () => {
    const back = text(consoleRows(input({ up: 20 })))
    expect(back.some((row) => row.includes("line 39"))).toBe(false)
    expect(back.at(-1)).toContain("20 rows up")
  })
})

describe("the head says each thing once, and the reason in full", () => {
  const failed: ShellInfo = {
    ...shell,
    status: "exited",
    exitCode: 1,
    signal: undefined,
    stopReason: undefined,
    cwd: "/p/web",
    summary:
      "FAIL src/auth/session.test.ts > creates a session > rejects an expired token after the grace period",
  }

  test("a title that is the command is not repeated under itself", () => {
    const rows = text(consoleRows(input({ shell: failed })))
    expect(rows.some((row) => row.includes("$ npm run test"))).toBe(false)
    const described = text(consoleRows(input({ shell: { ...failed, title: "Unit tests" } })))
    expect(described.some((row) => row.includes("$ npm run test"))).toBe(true)
  })

  test("a failure's reason wraps instead of being cut to one line", () => {
    const rows = text(consoleRows(input({ shell: failed, width: 60 })))
    const at = rows.findIndex((row) => row.includes("error: FAIL"))
    expect(at).toBeGreaterThan(-1)
    expect(rows.slice(at, at + 3).join(" ")).toContain("rejects an")
    for (const row of rows) expect(row).toHaveLength(60)
  })

  test("details too long for the dialog keep their top and count the rest", () => {
    const rows = text(consoleRows(input({ shell: failed, view: "details", height: 16 })))
    expect(rows.some((row) => row.includes("command"))).toBe(true)
    expect(rows.some((row) => /↓ \d+ more {3}\[w\] Full Screen/.test(row))).toBe(true)
  })
})

describe("the empty console", () => {
  const empty = (over: Partial<ConsoleInput>) => text(consoleRows(input({ shell: undefined, ...over })))
  const none = { ...input({}).keys, shell: false }

  test("names the scope it is empty for", () => {
    expect(empty({ keys: none }).join("\n")).toContain("No shells in this session")
    expect(empty({ keys: { ...none, scope: "project" } }).join("\n")).toContain("No shells in this project")
  })

  test("a hint too long for the row ends in an ellipsis, not half a word", () => {
    const rows = empty({ keys: none, width: 40 })
    expect(rows.some((row) => row.trimEnd().endsWith("…"))).toBe(true)
    for (const row of rows) expect(row).toHaveLength(40)
  })
})
