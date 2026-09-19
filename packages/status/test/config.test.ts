import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  asSegmentConfig,
  asStatusConfig,
  DEFAULT_SEGMENTS,
  DEFAULT_SEPARATOR,
  globalConfigPath,
  loadStatusConfig,
  mergeStatus,
  PROJECT_FILE,
  readStatusFile,
  resolveLines,
} from "../src/core/config.ts"

const dirs: string[] = []
const tmp = () => {
  const dir = mkdtempSync("/tmp/ck-status-")
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("reading the config", () => {
  test("a missing file is simply no settings", () => {
    expect(readStatusFile("/nowhere/at/all.json")).toEqual({})
  })

  // A typo in a config should cost you your settings, never the interface.
  test("a broken file is ignored rather than fatal", () => {
    const dir = tmp()
    const file = join(dir, "broken.json")
    writeFileSync(file, "{ not json")
    expect(readStatusFile(file)).toEqual({})
  })

  test("reads the statusline section out of a whole cockpit config", () => {
    const dir = tmp()
    const file = join(dir, PROJECT_FILE)
    writeFileSync(file, JSON.stringify({ watch: { auto: true }, statusline: { separator: " | " } }))
    expect(readStatusFile(file)).toEqual({ separator: " | " })
  })

  test("plugin-entry options are accepted as the section itself", () => {
    expect(asStatusConfig({ separator: " | ", segments: ["cwd"] })).toEqual({
      separator: " | ",
      segments: ["cwd"],
    })
  })

  test("anything that is not an object is no settings", () => {
    expect(asStatusConfig(undefined)).toEqual({})
    expect(asStatusConfig("nonsense")).toEqual({})
    expect(asStatusConfig(null)).toEqual({})
  })

  test("the global path follows XDG when it is set", () => {
    expect(globalConfigPath({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/opencode-cockpit/config.json")
    expect(globalConfigPath({ HOME: "/home/u" })).toBe("/home/u/.config/opencode-cockpit/config.json")
  })
})

describe("precedence", () => {
  test("the project file beats the global one, and plugin options beat both", () => {
    const config = tmp()
    const project = tmp()
    const env = { XDG_CONFIG_HOME: config }
    mkdirSync(join(config, "opencode-cockpit"), { recursive: true })
    writeFileSync(
      globalConfigPath(env),
      JSON.stringify({ statusline: { separator: " ~ ", segments: ["version"] } }),
    )

    // Global alone.
    expect(loadStatusConfig(project, undefined, env).separator).toBe(" ~ ")

    // The project overrides what it names and inherits what it does not.
    writeFileSync(join(project, PROJECT_FILE), JSON.stringify({ statusline: { separator: " | " } }))
    const merged = loadStatusConfig(project, undefined, env)
    expect(merged.separator).toBe(" | ")
    expect(merged.segments).toEqual(["version"])

    // The plugin entry wins over both.
    expect(loadStatusConfig(project, { separator: " / " }, env).separator).toBe(" / ")
  })

  // Listing segments in a project means "this line", not "these as well as the global ones".
  test("segments are replaced, not concatenated", () => {
    const merged = mergeStatus({ segments: ["cwd", "cost"] }, { segments: ["model"] })
    expect(merged.segments).toEqual(["model"])
  })

  test("commands from both sources are kept", () => {
    const merged = mergeStatus({ commands: { budget: { run: "a" } } }, { commands: { pods: { run: "b" } } })
    expect(Object.keys(merged.commands ?? {}).sort()).toEqual(["budget", "pods"])
  })
})

describe("resolving lines", () => {
  test("writing nothing gives the default line at the bottom", () => {
    const [line] = resolveLines({})
    expect(line?.surface).toBe("bottom")
    expect(line?.segments).toEqual(DEFAULT_SEGMENTS)
    expect(line?.separator).toBe(DEFAULT_SEPARATOR)
  })

  /**
   * OpenCode's own footer, sidebar and prompt already carry the path, branch, tokens, context
   * percentage, spend and model. A default that repeated them would draw the same figure several
   * times on one screen, which is exactly what it looked like before this rule.
   */
  test("the default line says nothing the host already says", () => {
    const host = ["cwd", "git.branch", "model", "context", "tokens", "cost"]
    for (const duplicated of host) {
      expect(DEFAULT_SEGMENTS).not.toContain(duplicated)
    }
    expect(DEFAULT_SEGMENTS.length).toBeGreaterThan(0)
  })

  test("the simple form is one line on the chosen surface", () => {
    const [line] = resolveLines({ surface: "sidebar", segments: ["cwd"], separator: " " })
    expect(line).toMatchObject({ surface: "sidebar", segments: ["cwd"], separator: " " })
  })

  test("several lines each pick up the shared defaults they did not set", () => {
    const lines = resolveLines({
      separator: " | ",
      segments: ["cwd"],
      lines: [{ surface: "bottom" }, { surface: "sidebar", segments: ["cost"] }],
    })
    expect(lines).toMatchObject([
      { surface: "bottom", segments: ["cwd"], separator: " | ", stack: "horizontal" },
      { surface: "sidebar", segments: ["cost"], separator: " | ", stack: "vertical" },
    ])
  })

  test("an empty lines array falls back rather than drawing nothing", () => {
    expect(resolveLines({ lines: [] })).toHaveLength(1)
  })

  // A four-column sidebar read across would be three truncated words.
  test("the sidebar stacks down by default, every other surface across", () => {
    const [side] = resolveLines({ surface: "sidebar" })
    expect(side?.stack).toBe("vertical")
    expect(side?.separator).toBe("")

    const [line] = resolveLines({ surface: "bottom" })
    expect(line?.stack).toBe("horizontal")
    expect(line?.separator).toBe(DEFAULT_SEPARATOR)
  })

  test("an explicit stack wins over the surface's default", () => {
    const [side] = resolveLines({ surface: "sidebar", stack: "horizontal" })
    expect(side?.stack).toBe("horizontal")
    expect(side?.separator).toBe(DEFAULT_SEPARATOR)
  })

  test("modules from both sources add up rather than replacing each other", () => {
    const merged = mergeStatus({ modules: ["~/a.ts"] }, { modules: ["./b.ts"] })
    expect(merged.modules).toEqual(["~/a.ts", "./b.ts"])
  })

  // Promised in the docs, so it has to actually reach the builder.
  test("icons are on by default and can be switched off globally or per line", () => {
    expect(resolveLines({})[0]?.icons).toBe(true)
    expect(resolveLines({ icons: false })[0]?.icons).toBe(false)
    expect(resolveLines({ icons: false, lines: [{ icons: true }] })[0]?.icons).toBe(true)
  })

  // The line should sit level with OpenCode's own furniture, not one column off it.
  test("each surface is padded to line up with the host, and can be overridden", () => {
    const [bottom] = resolveLines({ surface: "bottom" })
    expect(bottom?.paddingLeft).toBe(3) // OpenCode's footer indents three
    // A line hard against the bottom of the window reads as clipped.
    expect(bottom?.paddingBottom).toBe(1)
    const [side] = resolveLines({ surface: "sidebar" })
    expect(side?.paddingLeft).toBe(0) // flush with the shell bay's sidebar content
    const [own] = resolveLines({ surface: "bottom", lines: [{ paddingLeft: 0 }] })
    expect(own?.paddingLeft).toBe(0)
  })

  test("a bare string is that built-in with no settings", () => {
    expect(asSegmentConfig("cwd")).toEqual({ type: "cwd" })
    expect(asSegmentConfig({ type: "cwd", priority: 5 })).toEqual({ type: "cwd", priority: 5 })
  })
})
