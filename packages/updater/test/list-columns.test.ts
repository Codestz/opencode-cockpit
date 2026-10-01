/**
 * The plugins dialog at the widths it is really drawn at. The dialog clamps itself between 40 and 109
 * columns; the CLI's table takes the terminal's width.
 */

import { describe, expect, test } from "bun:test"
import { buildPlan } from "../src/core/plan.ts"
import { parseSpec } from "../src/core/spec.ts"
import { listRows } from "../src/core/view/layout.ts"
import { rowWidth } from "../src/core/view/rows.ts"

const LONG = "@acme/opencode-very-long-plugin-name"
const file = {
  path: "/home/me/.config/opencode/opencode.json",
  scope: "global" as const,
  owner: "config" as const,
}

const plans = buildPlan({
  plugins: [
    { name: "opencode-cockpit", source: "npm", running: "0.7.0" },
    { name: LONG, source: "npm", running: "1.2.0" },
    { name: "oc-offline", source: "npm", running: "2.0.0" },
    { name: "/home/me/work/plugins/shell-experiments", source: "file" },
  ],
  entries: [
    { file, spec: parseSpec("opencode-cockpit") },
    { file, spec: parseSpec(`${LONG}@latest`) },
    { file, spec: parseSpec("oc-offline") },
  ],
  published: new Map([
    ["opencode-cockpit", "0.7.1"],
    [LONG, "1.3.0"],
  ]),
  cacheDirs: new Map(),
})

const text = (width: number, dialog: boolean) =>
  listRows(plans, width, dialog ? { cursor: 0, selected: new Set() } : undefined, "/home/me").map((row) =>
    row.runs.map((run) => run.text).join(""),
  )
const line = (lines: string[], name: string) => lines.find((l) => l.includes(name)) ?? ""

describe("the plugins list", () => {
  const WIDTHS = [40, 60, 80, 100, 109, 180]

  test("every row is exactly its width, in the dialog and in the CLI", () => {
    for (const width of WIDTHS)
      for (const dialog of [true, false])
        for (const row of listRows(plans, width, dialog ? { cursor: 0, selected: new Set() } : undefined))
          expect(rowWidth(row)).toBe(width)
  })

  test("a name at the cap keeps its gap: `…-plugin-name1.2.0` read as one word", () => {
    for (const width of WIDTHS)
      for (const dialog of [true, false]) {
        const row = line(text(width, dialog), "@acme")
        expect(row).not.toMatch(/[^\s]1\.[23]\.0/)
      }
  })

  test("the published version and the state stay at every width, and the state is never cut", () => {
    for (const width of WIDTHS)
      for (const dialog of [true, false]) {
        const lines = text(width, dialog)
        expect(line(lines, "opencode-c")).toMatch(/0\.7\.1 +↑/)
        expect(line(lines, "oc-offline")).toMatch(/\? +unreachable *$/)
        expect(line(lines, "xperiments")).toMatch(/ local *$/)
        expect(lines[0]).toContain("published")
      }
  })

  test("short of room, `config` goes first, then `running`; the name keeps a readable floor", () => {
    const at = (width: number) => text(width, true)[0] ?? ""
    expect(at(100)).toMatch(/plugin +running +config +published/)
    expect(at(80)).toMatch(/plugin +running +config +published/)
    expect(at(60)).toMatch(/plugin +running +published/)
    expect(at(60)).not.toContain("config")
    expect(at(40)).toMatch(/plugin +published/)
    expect(at(40)).not.toContain("running")
    // At 60 the dropped column's room went to the name: twenty-odd characters of it, not twelve.
    expect(line(text(60, true), "@acme")).toContain("@acme/opencode-very")
  })

  test("with room to spare, a 36-character name is whole, and the spare width is at the end", () => {
    for (const width of [100, 180]) {
      const row = line(text(width, true), "@acme")
      expect(row).toContain(`${LONG}  1.2.0`)
      expect(row.trimEnd().length).toBeLessThan(90)
    }
  })

  test("a local plugin named by its path is cut from the left, keeping the end that names it", () => {
    expect(line(text(60, true), "experiments")).toMatch(/…\S*shell-experiments +local/)
    expect(line(text(100, true), "experiments")).toContain("~/work/plugins/shell-experiments")
  })
})
