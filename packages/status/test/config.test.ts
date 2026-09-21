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
  PRESETS,
  PROJECT_FILE,
  readStatusFile,
  resolveLines,
} from "../src/core/config.ts"
import { findSegment } from "../src/core/segments.ts"

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

/**
 * A preset is the answer to "I want a good statusline, not a design exercise" — so it has to be a
 * starting point that anything written beside it overrides, never a mode that ignores you.
 */
describe("presets", () => {
  test("a name gives you a whole line", () => {
    const [line] = resolveLines({ preset: "minimal" })
    expect(line?.segments.length).toBeGreaterThan(0)
    expect(line?.surface).toBe("bottom")
  })

  test("a preset brings its own surface", () => {
    expect(resolveLines({ preset: "sidebar" })[0]?.surface).toBe("sidebar")
    expect(resolveLines({ preset: "sidebar" })[0]?.stack).toBe("vertical")
  })

  test("anything written beside it wins", () => {
    const [line] = resolveLines({ preset: "minimal", separator: "  ", segments: ["cwd"] })
    expect(line?.separator).toBe("  ")
    expect(line?.segments).toEqual(["cwd"])
  })

  test("a name nothing answers to falls back rather than drawing nothing", () => {
    const [line] = resolveLines({ preset: "nope" })
    expect(line?.segments).toEqual(DEFAULT_SEGMENTS)
  })

  test("every preset uses only built-ins, so none of them needs a module", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      for (const entry of preset.segments) {
        const type = typeof entry === "string" ? entry : entry.type
        expect(findSegment(type), `${name} uses "${type}"`).toBeDefined()
      }
    }
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
  /**
   * The rule is not to avoid every fact OpenCode mentions -- it is to avoid saying one no better
   * than the host does. A bar with the breakdown beside it is a different instrument from
   * "78.5K (39%)" in a corner; a second copy of the path or the model is just a second copy.
   */
  test("the default line adds nothing that is only a second copy", () => {
    const types = DEFAULT_SEGMENTS.map((entry) => (typeof entry === "string" ? entry : entry.type))
    for (const copied of ["cwd", "git.branch", "model", "cost"]) {
      expect(types).not.toContain(copied)
    }
  })

  test("the default line leads with the instrument the host does not offer", () => {
    const [first] = DEFAULT_SEGMENTS
    expect(typeof first === "string" ? first : first?.type).toBe("context")
    expect(typeof first === "string" ? undefined : first?.style).toBe("bar")
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

  /**
   * Writing these at the top level is the natural guess, and having them quietly ignored costs
   * exactly the rows they were meant to keep.
   */
  test("maxRows and padding can be set once for every line", () => {
    const [line] = resolveLines({ surface: "sidebar", maxRows: 20, paddingLeft: 4 })
    expect(line?.maxRows).toBe(20)
    expect(line?.paddingLeft).toBe(4)
  })

  test("a line still overrides what the top level set", () => {
    const [line] = resolveLines({ maxRows: 20, lines: [{ surface: "sidebar", maxRows: 3 }] })
    expect(line?.maxRows).toBe(3)
  })

  test("a bare string is that built-in with no settings", () => {
    expect(asSegmentConfig("cwd")).toEqual({ type: "cwd" })
    expect(asSegmentConfig({ type: "cwd", priority: 5 })).toEqual({ type: "cwd", priority: 5 })
  })
})

/**
 * Two bays share the sidebar and draw in registration order, which was a constant nobody could
 * reach. A key the loader drops is a setting that silently does nothing.
 */
describe("where the line sits among other bays", () => {
  test("sidebarOrder survives the loader, from a file and from plugin options", () => {
    expect(asStatusConfig({ statusline: { sidebarOrder: 120 } }).sidebarOrder).toBe(120)
    expect(asStatusConfig({ sidebarOrder: 120 }).sidebarOrder).toBe(120)
  })

  test("and is absent when nobody set it, so the default stands", () => {
    expect(asStatusConfig({ surface: "sidebar" }).sidebarOrder).toBeUndefined()
  })
})
