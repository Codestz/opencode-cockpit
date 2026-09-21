/**
 * Seen on a real work machine after 0.5.0: `opencode-worktree@latest` in the plugin list. On npm that
 * name is a command-line tool with no plugin entry points — OpenCode refuses it ("does not expose
 * plugin entrypoints") — and the updater proposed to pin it, then failed with that same refusal.
 * These cases are reproduced from the real package's manifest.
 */

import { describe, expect, test } from "bun:test"
import { paint } from "../src/cli/ansi.ts"
import { type Io, update } from "../src/cli/run.ts"
import { isPluginManifest } from "../src/core/cache.ts"
import { memoryDisk } from "../src/core/disk.ts"
import { gather } from "../src/core/gather.ts"
import { listRows, noteRows, reviewRows } from "../src/core/view/layout.ts"

const HOME = "/home/me"
const CONFIG = `${HOME}/.config/opencode/opencode.json`
const PKGS = `${HOME}/.cache/opencode/packages`

/** `opencode-worktree@0.4.1`'s real manifest, trimmed to the fields that decide it. */
const WORKTREE = {
  name: "opencode-worktree",
  version: "0.4.1",
  type: "module",
  bin: { "opencode-worktree": "bin/opencode-worktree" },
  dependencies: { "@opentui/core": "^0.1.75" },
}

const machine = (manifest: object, spec = "opencode-worktree@latest") => ({
  [CONFIG]: JSON.stringify({ plugin: [spec] }),
  [`${PKGS}/${spec}/node_modules/opencode-worktree/package.json`]: JSON.stringify(manifest),
})

const found = (files: Record<string, string>, listed: { id: string; source: "npm"; spec: string }[] = []) =>
  gather({
    env: {},
    home: HOME,
    disk: memoryDisk(files),
    fetchLatest: async (names) => new Map(names.map((n) => [n, "0.4.1"])),
    listed,
  })

describe("a package that is not an OpenCode plugin", () => {
  test("OpenCode's own rule: tui or server exports, main, or oc-themes", () => {
    expect(isPluginManifest(WORKTREE)).toBe(false)
    expect(isPluginManifest({ main: "index.js" })).toBe(true)
    expect(isPluginManifest({ exports: { "./tui": "./dist/tui.js" } })).toBe(true)
    expect(isPluginManifest({ exports: { "./server": "./dist/server.js" } })).toBe(true)
    expect(isPluginManifest({ "oc-themes": ["themes/dark.json"] })).toBe(true)
    expect(isPluginManifest({ exports: { ".": "./index.js" } })).toBe(false)
  })

  test("is named for what it is, and nothing is proposed for it", async () => {
    const { plans } = await found(machine(WORKTREE))
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      state: "not-plugin",
      selected: false,
      changes: [],
      commands: [],
      remove: [],
    })
    const list = paint(listRows(plans, 100), false)
    expect(list).toContain("not a plugin")
    expect(paint(noteRows(plans, 110, HOME), false)).toContain(
      "opencode-worktree is not an OpenCode plugin — remove it from ~/.config/opencode/opencode.json",
    )
  })

  test("a manifest that cannot be read proves nothing", async () => {
    const files = { [CONFIG]: JSON.stringify({ plugin: ["opencode-worktree@latest"] }) }
    const { plans } = await found(files)
    expect(plans[0]?.state).not.toBe("not-plugin")
  })

  test("what the host already loaded is a plugin, whatever its manifest says", async () => {
    const { plans } = await found(machine(WORKTREE), [
      { id: "opencode-worktree", source: "npm", spec: "opencode-worktree@latest" },
    ])
    expect(plans[0]?.state).not.toBe("not-plugin")
  })

  test("the CLI says what to remove, and offers no update", async () => {
    const out: string[] = []
    const calls: string[][] = []
    const files = machine(WORKTREE)
    const io: Io = {
      env: {},
      home: HOME,
      cwd: HOME,
      disk: memoryDisk(files),
      worktree: () => undefined,
      fetchLatest: async (names) => new Map(names.map((n) => [n, "0.4.1"])),
      opencode: async (args) => {
        calls.push([...args])
        return { status: 0, output: "" }
      },
      remove: () => {},
      write: (text) => out.push(text),
      width: 110,
      color: false,
    }
    expect(await update(["--yes"], io)).toBe(0)
    const text = out.join("")
    expect(text).toContain("is not an OpenCode plugin — remove it from ~/.config/opencode/opencode.json")
    expect(text).not.toContain("→")
    expect(calls).toEqual([])
  })
})

describe("a pin says what it is for", () => {
  test("not `0.4.1 → 0.4.1`, which read as a bug", async () => {
    const { plans } = await found(machine({ ...WORKTREE, exports: { "./server": "./s.js" } }))
    expect(plans[0]?.state).toBe("pin")
    const band = paint(reviewRows(plans, 100, HOME), false).split("\n")[0] ?? ""
    expect(band).toContain("0.4.1  ·  pin, so latest cannot freeze again")
    expect(band).not.toContain("→")
  })

  test("a long config path keeps its file name", () => {
    const plans = [
      {
        name: "opencode-worktree",
        state: "not-plugin" as const,
        source: "npm" as const,
        specs: [],
        files: ["/private/tmp/a/very/deep/sandbox/path/that/goes/on/cfg/opencode/opencode.json"],
        frozen: false,
        changes: [],
        commands: [],
        remove: [],
        selected: false,
      },
    ]
    const text = paint(noteRows(plans, 90), false)
    expect(text).toMatch(/…\S*opencode\/opencode\.json\n$/)
  })
})
