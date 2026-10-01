/**
 * The preview is how Shell's surfaces get looked at (docs/building/testing.md), and the sidebar rows
 * it draws are the ones OpenCode draws. Both are held to the grid here: every row exactly its width,
 * and the sidebar's facts in one column against the right edge.
 */

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { SAMPLE_LIST, SAMPLE_NOW, SHELLS } from "../src/cli/samples.ts"
import { sidebarCounts, sidebarRow, sidebarRowText } from "../src/tui/lib/sidebar.ts"
import { shortDetail, watchLabel } from "../src/tui/lib/view.ts"

const PREVIEW = join(import.meta.dir, "..", "src", "cli", "preview.ts")

const preview = (...args: string[]) => {
  const run = Bun.spawnSync(["bun", PREVIEW, ...args], { env: { ...process.env, NO_COLOR: "1" } })
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() }
}

/** The rows of one titled section of the preview's output. */
const section = (out: string, title: string): string[] => {
  const lines = out.split("\n")
  const at = lines.findIndex((line) => line.startsWith(title))
  const rows: string[] = []
  for (const line of lines.slice(at + 2)) {
    if (line === "") break
    rows.push(line)
  }
  return rows
}

describe("the sidebar row", () => {
  const WIDTHS = [20, 26, 30, 36, 38, 42, 60]

  test("is exactly its width, for every kind of shell, at every width", () => {
    for (const width of WIDTHS)
      for (const shell of SAMPLE_LIST)
        expect(sidebarRowText(sidebarRow(shell, SAMPLE_NOW, 2, width)).length).toBe(width)
  })

  test("puts its detail against the right edge, so the details are a column", () => {
    for (const width of [36, 38, 42, 60])
      for (const shell of SAMPLE_LIST) {
        const text = sidebarRowText(sidebarRow(shell, SAMPLE_NOW, 2, width))
        expect(text.endsWith(shortDetail(shell, SAMPLE_NOW))).toBe(true)
      }
  })

  test("starts every title in the same column, after the seven-column badge", () => {
    for (const shell of SAMPLE_LIST) {
      const row = sidebarRow(shell, SAMPLE_NOW, 2, 38)
      expect(`${row.rule}${row.label}`.length).toBe(7)
      expect(row.title[0]).toBe(" ")
      expect(row.title[1]).toBe(shell.title[0])
    }
  })

  test("gives a title the room the row has, not a fixed twenty characters", () => {
    const row = sidebarRow(SHELLS.failed, SAMPLE_NOW, 2, 60)
    expect(row.title.trim()).toBe(SHELLS.failed.title)
    expect(sidebarRow(SHELLS.failed, SAMPLE_NOW, 2, 38).title.trim()).toMatch(/^npm run test -- --cov.*…$/)
  })

  test("short of room, a running time goes before a watch, and a failure keeps its exit code", () => {
    const watched = sidebarRow(SHELLS.running, SAMPLE_NOW, 2, 30)
    expect(watched.watch).toBe(watchLabel(SHELLS.running))
    expect(watched.detail).toBe("")
    expect(sidebarRowText(watched).endsWith("watch tsc ✗")).toBe(true)
    expect(sidebarRow(SHELLS.failed, SAMPLE_NOW, 2, 26).detail).toBe("exit 1")
  })

  test("the heading counts each kind, stopped shells with the finished", () => {
    expect(sidebarCounts(SAMPLE_LIST)).toBe("2 run · 1 fail · 2 done")
    expect(sidebarCounts([])).toBe("")
  })
})

describe("the preview", () => {
  test("runs with no OpenCode and no daemon, and draws all three surfaces", () => {
    const { code, out, err } = preview("--columns", "100")
    expect(err).toBe("")
    expect(code).toBe(0)
    expect(out).toContain("Sidebar — 38 columns")
    expect(out).toContain("Dock — 100 columns")
    for (const state of ["empty", "running", "failed", "details", "log", "done"])
      expect(out).toContain(`Console — ${state}:`)
    // Plain text under NO_COLOR, as every bay's preview prints into a pipe.
    expect(out).not.toContain("\x1b[")
  })

  test("every row of every surface is exactly its width", () => {
    for (const columns of [40, 60, 100, 180]) {
      const { out } = preview("--columns", String(columns), "--width", "34")
      for (const row of section(out, "Sidebar —")) expect([...row].length).toBe(34)
      for (const row of section(out, "Dock —")) expect([...row].length).toBe(columns)
      for (const state of ["empty", "running", "failed", "details", "log", "done"])
        for (const row of section(out, `Console — ${state}:`)) expect([...row].length).toBe(columns)
    }
  })

  test("draws one part, one state, and says what it takes", () => {
    const one = preview("--part", "console", "--state", "failed", "--columns", "60").out
    expect(one).not.toContain("Sidebar")
    expect(one).toContain("Console — failed:")
    expect(one).not.toContain("Console — running:")
    expect(one).toContain("error: FAIL src/auth/session.test.ts")
    const help = preview("--help")
    expect(help.code).toBe(0)
    expect(help.out).toContain("Usage: shell preview")
    for (const flag of ["--part", "--state", "--width", "--columns"]) expect(help.out).toContain(flag)
    expect(preview("--state", "nope").code).toBe(1)
  })
})
