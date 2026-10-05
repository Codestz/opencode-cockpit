import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { watchArgs } from "../src/agent/tools/watch-args.ts"
import { loadConfig, loadShell } from "../src/core/config.ts"

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync("/tmp/ck-conf-")
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

describe("config", () => {
  test("project settings override global ones, and plugin options override both", () => {
    const { directory, env } = files(
      { shell: { guidance: false, dockHeight: 10, sidebarRows: 3 } },
      { shell: { dockHeight: 20 } },
    )
    const config = loadConfig(directory, { sidebarRows: 9 }, env)
    expect(config.guidance).toBe(false) // only the global file set it
    expect(config.dockHeight).toBe(20) // project wins over global
    expect(config.sidebarRows).toBe(9) // options win over both
  })

  test("the bundle's `shell` section and a standalone entry's own keys read the same", () => {
    const { directory, env } = files(undefined)
    const keys = { "cockpit.shells.dock": "<leader>j" }
    for (const options of [
      { shell: { dockHeight: 16, keybinds: keys } },
      { dockHeight: 16, keybinds: keys },
    ]) {
      const config = loadConfig(directory, options, env)
      expect(config.dockHeight).toBe(16)
      expect(config.keybinds).toEqual(keys)
    }
  })

  test("sections merge key by key instead of replacing each other", () => {
    const { directory, env } = files(
      { shell: { watch: { auto: true, presets: { a: { done: "1" } } }, kinds: { db: "psql" } } },
      { shell: { watch: { presets: { b: { done: "2" } } } } },
    )
    const config = loadConfig(directory, undefined, env)
    expect(config.watch?.auto).toBe(true)
    expect(Object.keys(config.watch?.presets ?? {})).toEqual(["a", "b"])
    expect(config.kinds).toEqual({ db: "psql" })
  })

  test("defaults: present when empty, finished shells stay 30 minutes, the screen view", () => {
    const { directory, env } = files(undefined)
    const config = loadConfig(directory, undefined, env)
    expect(config).toMatchObject({
      sidebarRows: 5,
      hideWhenEmpty: false,
      hideFinishedAfterMinutes: 30,
      dockHeight: 14,
      colors: true,
      defaultView: "screen",
      guidance: true,
      listRunningShells: 15,
    })
    expect(config.dockOpen).toBeUndefined()
  })

  test("comments and trailing commas no longer drop the file", () => {
    const { directory, env } = files(`{
      // mine
      "shell": { "dockHeight": 22, },
    }`)
    expect(loadConfig(directory, undefined, env).dockHeight).toBe(22)
  })

  test("a broken file is ignored with a notice, never fatal", () => {
    const { directory, env } = files(undefined, "{ not json")
    const { config } = loadShell(directory, undefined, env)
    expect(config.dockHeight).toBe(14)
  })

  /** Names from before 0.9 are unknown names now: /cockpit-setup and doctor say so, the block does not. */
  test("the old places are not read: root keys, `ui`, `ui.historyMinutes`", () => {
    const { directory, env } = files({
      guidance: false,
      ui: { dockHeight: 30, historyMinutes: 5, sidebarOrder: 1 },
    })
    const { config, notices } = loadShell(directory, { ui: { sidebarRows: 2 } }, env)
    expect(config.guidance).toBe(true)
    expect(config.dockHeight).toBe(14)
    expect(config.hideFinishedAfterMinutes).toBe(30)
    expect(config.sidebarRows).toBe(5)
    expect(notices).toEqual([])
  })

  test("a value of the wrong kind is the default, and an unknown view is the screen", () => {
    const { directory, env } = files({ shell: { dockHeight: "16", defaultView: "tv", dockOpen: "yes" } })
    const { config, notices } = loadShell(directory, undefined, env)
    expect(config.dockHeight).toBe(14)
    expect(config.defaultView).toBe("screen")
    expect(config.dockOpen).toBeUndefined()
    expect(notices.some((notice) => notice.old === "shell.dockHeight")).toBe(true)
  })

  test("the block's place is the `sidebar` list's; `enabled` and `features.shell` switch it off", () => {
    const { directory, env } = files({ sidebar: ["shell"], features: { shell: false } })
    const { order, config } = loadShell(directory, undefined, env)
    expect(order).toBe(110)
    expect(config.enabled).toBe(false)
  })
})

describe("watch arguments", () => {
  test("rules survive however the model wrote them", () => {
    const rule = { done: "\\d+ passed", fail: "\\d+ failed" }
    expect(watchArgs(rule, {})).toEqual({ rule })
    expect(watchArgs(JSON.stringify(rule), {})).toEqual({ rule })
    // Under-escaped JSON: a regex written straight into a string literal.
    expect(watchArgs('{"done": "\\d+ passed"}', {})).toEqual({ rule: { done: "\\d+ passed" } })
    expect(watchArgs(true, {})).toEqual({ preset: "auto" })
    expect(watchArgs("tsc", {})).toEqual({ preset: "tsc" })
    expect(watchArgs("{not json", {})).toEqual({ preset: "{not json" })
    // A config preset is resolved locally, so the daemon never sees a name it lacks.
    expect(watchArgs("e2e", { watch: { presets: { e2e: { fail: "boom" } } } })).toEqual({
      rule: { fail: "boom" },
    })
  })
})
