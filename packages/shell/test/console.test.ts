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
