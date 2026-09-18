import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { globalConfigPath, loadConfig, mergeConfig, readConfigFile } from "../src/core/config.ts"

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync("/tmp/ck-conf-")
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("config", () => {
  test("project settings override global ones, and plugin options override both", () => {
    const home = temp()
    const project = temp()
    const globalFile = globalConfigPath({ XDG_CONFIG_HOME: home })
    mkdirSync(dirname(globalFile), { recursive: true })
    writeFileSync(globalFile, JSON.stringify({ guidance: false, ui: { dockHeight: 10, sidebarRows: 3 } }))
    writeFileSync(join(project, ".cockpit.json"), JSON.stringify({ ui: { dockHeight: 20 } }))

    const config = loadConfig(project, { ui: { sidebarRows: 9 } }, { XDG_CONFIG_HOME: home })
    expect(config.guidance).toBe(false) // only the global file set it
    expect(config.ui?.dockHeight).toBe(20) // project wins over global
    expect(config.ui?.sidebarRows).toBe(9) // options win over both
  })

  test("old flat plugin options still work", () => {
    const config = loadConfig(
      temp(),
      { dockHeight: 16, keybinds: { "cockpit.shells.dock": "<leader>j" } },
      {},
    )
    expect(config.ui?.dockHeight).toBe(16)
    expect(config.ui?.keybinds).toEqual({ "cockpit.shells.dock": "<leader>j" })
  })

  test("sections merge key by key instead of replacing each other", () => {
    const merged = mergeConfig(
      { watch: { auto: true, presets: { a: { done: "1" } } }, kinds: { db: "psql" } },
      { watch: { presets: { b: { done: "2" } } } },
    )
    expect(merged.watch?.auto).toBe(true)
    expect(Object.keys(merged.watch?.presets ?? {})).toEqual(["a", "b"])
    expect(merged.kinds).toEqual({ db: "psql" })
  })

  test("a broken or missing file is ignored, never fatal", () => {
    const dir = temp()
    writeFileSync(join(dir, ".cockpit.json"), "{ not json")
    expect(readConfigFile(join(dir, ".cockpit.json"))).toEqual({})
    expect(readConfigFile(join(dir, "nope.json"))).toEqual({})
    expect(loadConfig(dir, undefined, {})).toBeDefined()
  })
})
