import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadSubagents } from "../src/core/config.ts"
import { applyAll, emptyModel, firstWords, subagentsOf, titleOf } from "../src/core/model/model.ts"
import { SAMPLE_NOW, SAMPLE_ROOT, sample } from "../src/core/sample.ts"
import { rowText, widthOf } from "../src/core/view/rows.ts"
import { SUBAGENT_KEYS, screenRows } from "../src/core/view/screen.ts"

/**
 * Subagents reads the files now, both halves, through the loader every bay shares: the `subagents`
 * section, then the plugin entry. Before 0.9 it read no file, and its time keys carried no unit.
 */

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync("/tmp/ck-sub-")
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A global file and a project file, as written; the env points the loader at the global one. */
function files(global: string | object | undefined, project?: string | object) {
  const home = temp()
  const directory = temp()
  const text = (value: string | object) => (typeof value === "string" ? value : JSON.stringify(value))
  if (global !== undefined) {
    mkdirSync(join(home, "opencode-cockpit"), { recursive: true })
    writeFileSync(join(home, "opencode-cockpit", "config.json"), text(global))
  }
  if (project !== undefined) writeFileSync(join(directory, ".cockpit.json"), text(project))
  return { directory, env: { XDG_CONFIG_HOME: home } }
}

describe("settings", () => {
  test("the `subagents` section of either file, and the entry's options over both", () => {
    const { directory, env } = files(
      `{ // comments are fine
        "subagents": { "sidebarRows": 3, "hideNestedAfterSeconds": 10, "guidance": false, },
      }`,
      { subagents: { sidebarRows: 4, hideWhenEmpty: true } },
    )
    const { config, notices } = loadSubagents(directory, { hideFinishedAfterMinutes: 15 }, env)
    expect(config.sidebarRows).toBe(4)
    expect(config.hideWhenEmpty).toBe(true)
    expect(config.hideNestedAfterSeconds).toBe(10)
    expect(config.hideFinishedAfterMinutes).toBe(15)
    expect(config.guidance).toBe(false)
    expect(notices).toEqual([])
  })

  test("defaults: six rows, present when empty, nested ones leave after 30 s, finished ones stay", () => {
    const { directory, env } = files(undefined)
    const { config } = loadSubagents(directory, undefined, env)
    expect(config).toMatchObject({
      sidebarRows: 6,
      hideWhenEmpty: false,
      hideNestedAfterSeconds: 30,
      guidance: true,
    })
    expect(config.hideFinishedAfterMinutes).toBeUndefined()
    expect(config.enabled).toBe(true)
  })

  test("old names are not read: each is a notice naming the new one", () => {
    const { directory, env } = files({ subagents: { hideFinishedAfter: 5, sidebarOrder: 2 } })
    const { config, notices } = loadSubagents(directory, { hideNestedAfter: 9 }, env)
    expect(config.hideFinishedAfterMinutes).toBeUndefined()
    expect(config.hideNestedAfterSeconds).toBe(30)
    expect(notices.map((notice) => [notice.old, notice.new])).toEqual(
      expect.arrayContaining([
        ["subagents.hideFinishedAfter", "subagents.hideFinishedAfterMinutes"],
        ["subagents.sidebarOrder", "sidebar"],
        ["hideNestedAfter", "subagents.hideNestedAfterSeconds"],
      ]),
    )
  })

  test("a value of the wrong kind is the default, with a notice; the order is the `sidebar` list's", () => {
    const { directory, env } = files({
      sidebar: ["shell", "subagents"],
      subagents: { sidebarRows: "8", hideFinishedAfterMinutes: "ten" },
    })
    const { config, order, notices } = loadSubagents(directory, undefined, env)
    expect(config.sidebarRows).toBe(6)
    expect(config.hideFinishedAfterMinutes).toBeUndefined()
    expect(notices.some((notice) => notice.old === "subagents.sidebarRows")).toBe(true)
    /** Second in the list: 110, then 120 (client/settings `orderOf`). */
    expect(order).toBe(120)
  })

  test("`features.subagents: false` in a file turns both halves off", () => {
    const { directory, env } = files({ features: { subagents: false } })
    expect(loadSubagents(directory, undefined, env).config.enabled).toBe(false)
  })
})

describe("a name, always", () => {
  const session = (title: string, task?: string) => {
    const m = applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "general", title, at: 1 },
      ...(task ? [{ type: "prompt" as const, id: "c", key: "u", text: task, at: 1 }] : []),
    ])
    return subagentsOf(m, "p")[0]?.session as NonNullable<ReturnType<typeof subagentsOf>[number]>["session"]
  }

  test("its title; with none, or only OpenCode's placeholder, its task's first words", () => {
    expect(titleOf(session("Map the auth flow", "Read every file"))).toBe("Map the auth flow")
    expect(titleOf(session("", "\n  Find every caller of exportCsv\nthen list them"))).toBe(
      "Find every caller of exportCsv",
    )
    expect(titleOf(session("Child session - 2026-10-03T10:00:00.000Z", "Check the tests"))).toBe(
      "Check the tests",
    )
    expect(titleOf(session("   ", undefined))).toBe("subagent")
  })

  test("first words are a name, not the task", () => {
    expect(firstWords("one two three four five six seven eight nine ten")).toBe(
      "one two three four five six seven eight…",
    )
    expect(firstWords(undefined)).toBe("")
  })
})

describe("[?] Keys", () => {
  const nodes = subagentsOf(applyAll(emptyModel(), sample()), SAMPLE_ROOT)
  const session = nodes[0]?.session
  if (!session) throw new Error("the sample has no subagent")
  const input = (width: number, height: number, keys: boolean) => ({
    session,
    nodes,
    width,
    height,
    now: SAMPLE_NOW,
    frame: 0,
    open: new Set<string>(),
    closed: new Set<string>(),
    thinking: false,
    details: false,
    keys,
  })

  test("the footer offers it, and on it the only key is the way back", () => {
    const run = screenRows(input(120, 40, false))
      .rows.map(rowText)
      .join("\n")
    expect(run).toContain("[?] Keys")
    const keys = screenRows(input(120, 40, true))
    const text = keys.rows.map(rowText).join("\n")
    expect(text).toContain("KEYS")
    for (const line of SUBAGENT_KEYS) expect(text).toContain(line.does.split(" ").slice(0, 3).join(" "))
    expect(text).toContain("[esc] Hide Keys")
    expect(text).not.toContain("[m] Message")
    /** Nothing on it is an item: j/k and enter have nothing to land on. */
    expect(keys.keys).toEqual([])
  })

  test("every row its width, every screen its height; cut short, it says how much is below", () => {
    for (const [width, height] of [
      [72, 16],
      [72, 40],
      [140, 40],
    ] as const) {
      const screen = screenRows(input(width, height, true))
      expect(screen.rows).toHaveLength(height)
      for (const row of screen.rows) expect(widthOf(rowText(row))).toBe(width)
    }
    expect(
      screenRows(input(72, 16, true))
        .rows.map(rowText)
        .join("\n"),
    ).toMatch(/↓ \d+ more lines — \[d\] scrolls/)
  })
})
