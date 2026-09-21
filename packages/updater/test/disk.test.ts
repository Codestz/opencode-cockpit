import { describe, expect, test } from "bun:test"
import {
  cacheDirsFor,
  cacheRoot,
  installedVersion,
  layoutVersion,
  runningVersion,
} from "../src/core/cache.ts"
import { configFiles, readConfigs } from "../src/core/configs.ts"
import { memoryDisk } from "../src/core/disk.ts"

const HOME = "/home/me"
const CACHE = "/home/me/.cache/opencode"

describe("cache", () => {
  test("honours XDG_CACHE_HOME", () => {
    expect(cacheRoot({}, HOME)).toBe(CACHE)
    expect(cacheRoot({ XDG_CACHE_HOME: "/x" }, HOME)).toBe("/x/opencode")
  })

  test("reads the layout version", () => {
    expect(layoutVersion(memoryDisk({ [`${CACHE}/version`]: "18\n" }), CACHE)).toBe("18")
    expect(layoutVersion(memoryDisk({}), CACHE)).toBeUndefined()
  })

  test("finds every spec directory of a plugin, and no other plugin's", () => {
    const disk = memoryDisk({
      [`${CACHE}/packages/opencode-cockpit@latest/package.json`]: "{}",
      [`${CACHE}/packages/opencode-cockpit@0.2.2/package.json`]: "{}",
      [`${CACHE}/packages/opencode-cockpit-extra@1.0.0/package.json`]: "{}",
      [`${CACHE}/packages/@opencode-cockpit/shell@0.4.3/package.json`]: "{}",
    })
    expect(cacheDirsFor(disk, CACHE, "opencode-cockpit")).toEqual([
      `${CACHE}/packages/opencode-cockpit@0.2.2`,
      `${CACHE}/packages/opencode-cockpit@latest`,
    ])
    expect(cacheDirsFor(disk, CACHE, "@opencode-cockpit/shell")).toEqual([
      `${CACHE}/packages/@opencode-cockpit/shell@0.4.3`,
    ])
    expect(cacheDirsFor(disk, CACHE, "missing")).toEqual([])
  })

  test("`@latest` installed whatever was newest that day", () => {
    const disk = memoryDisk({
      [`${CACHE}/packages/opencode-cockpit@latest/node_modules/opencode-cockpit/package.json`]:
        '{"name":"opencode-cockpit","version":"0.1.2"}',
    })
    expect(installedVersion(disk, CACHE, "opencode-cockpit@latest", "opencode-cockpit")).toBe("0.1.2")
  })

  test("the running version is the nearest package.json that names the plugin", () => {
    const root = `${CACHE}/packages/x@latest/node_modules/x`
    const disk = memoryDisk({
      [`${CACHE}/packages/x@latest/package.json`]: '{"dependencies":{"x":"1.0.0"}}',
      [`${root}/package.json`]: '{"name":"x","version":"1.0.0"}',
      [`${root}/dist/nested/package.json`]: '{"type":"module"}',
    })
    expect(runningVersion(disk, `${root}/dist/nested/index.js`, "x")).toBe("1.0.0")
    expect(runningVersion(disk, "/elsewhere/index.js", "x")).toBeUndefined()
  })
})

describe("configs", () => {
  test("global files are the command's; a project's root files are only a person's", () => {
    const files = configFiles({ env: {}, home: HOME, worktree: "/work/app" })
    const owner = (path: string) => files.find((f) => f.path === path)?.owner
    expect(owner("/home/me/.config/opencode/opencode.jsonc")).toBe("command")
    expect(owner("/work/app/.opencode/tui.json")).toBe("command")
    expect(owner("/work/app/opencode.json")).toBe("manual")
    expect(configFiles({ env: {}, home: HOME }).every((f) => f.scope === "global")).toBe(true)
  })

  test("reads entries from jsonc, tuples included, and reports a broken file", () => {
    const disk = memoryDisk({
      "/home/me/.config/opencode/opencode.jsonc": `{
        // mine
        "plugin": ["opencode-cockpit", ["opencode-foo@1.2.0", { "x": 1 }],],
      }`,
      "/home/me/.config/opencode/tui.json": `{"plugin": [`,
    })
    const read = readConfigs(configFiles({ env: {}, home: HOME }), disk)
    expect(read.entries.map((e) => e.spec.raw)).toEqual(["opencode-cockpit", "opencode-foo@1.2.0"])
    expect(read.errors.map((e) => e.path)).toEqual(["/home/me/.config/opencode/tui.json"])
  })
})
