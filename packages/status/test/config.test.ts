import { describe, expect, test } from "bun:test"
import {
  asSegmentConfig,
  configNotices,
  DEFAULT_SEGMENTS,
  DEFAULT_SEPARATOR,
  type LineConfig,
  loadStatus,
  PRESETS,
  resolveLines,
  SIDEBAR_SEGMENTS,
  type StatusConfig,
} from "../src/core/config.ts"
import { FIXTURES } from "../src/core/fixtures.ts"
import { fitColumn } from "../src/core/render.ts"
import { buildSegments, findSegment } from "../src/core/segments.ts"

const rowText = (runs: readonly { text: string }[]) => runs.map((run) => run.text).join("")

/** Both files in memory, through the loader every bay reads with. */
const GLOBAL = "/cfg/opencode-cockpit/config.json"
const PROJECT = "/w/app/.cockpit.json"
const load = (files: Record<string, unknown>, options?: unknown) =>
  loadStatus({
    options,
    where: {
      directory: "/w/app",
      env: { XDG_CONFIG_HOME: "/cfg" },
      read: (path) => {
        const file = files[path]
        return file === undefined ? undefined : typeof file === "string" ? file : JSON.stringify(file)
      },
    },
  })

describe("reading the config", () => {
  test("no file at all is no settings, and nothing to fix", () => {
    const loaded = load({})
    expect(loaded.config).toEqual({})
    expect(loaded.notices).toEqual([])
  })

  test("reads the `status` section, comments and trailing commas included", () => {
    const loaded = load({ [GLOBAL]: '{\n  // mine\n  "status": { "separator": " | ", },\n}' })
    expect(loaded.config.separator).toBe(" | ")
    expect(loaded.notices).toEqual([])
  })

  /** A typo in a config should cost you your settings, never the interface — and it says so. */
  test("a broken file is ignored, with a `!` row that says the file could not be read", () => {
    const loaded = load({ [GLOBAL]: "{ not json" })
    expect(loaded.config).toEqual({})
    expect(loaded.notices).toHaveLength(1)
    expect(loaded.notices[0]).toMatch(/^settings: .*the whole file is ignored$/)
  })

  test("plugin-entry options are accepted as the section itself, or as a whole config", () => {
    expect(load({}, { separator: " | ", segments: ["cwd"] }).config).toMatchObject({
      separator: " | ",
      segments: ["cwd"],
    })
    expect(load({}, { status: { separator: " / " } }).config.separator).toBe(" / ")
  })

  test("a value of the wrong kind is dropped, with a row naming the key", () => {
    const loaded = load({ [GLOBAL]: { status: { icons: "no", separator: " | " } } })
    expect(loaded.config).toEqual({ separator: " | " })
    expect(loaded.notices).toEqual(['settings: "status.icons" should be a boolean; the default is used'])
  })

  test("off by `enabled`, or by the bundle's `features.status`", () => {
    expect(load({ [GLOBAL]: { status: { enabled: false } } }).config.enabled).toBe(false)
    expect(load({ [GLOBAL]: { features: { status: false } } }).config.enabled).toBe(false)
  })
})

/**
 * 0.9 renamed the section and stopped reading the file's root as Status's. Neither is read, and
 * neither is silent: each is a `!` row, which is how a 0.8 config learns what changed.
 */
describe("old names", () => {
  test("`statusline` is not read: it is a notice that names the fix", () => {
    const loaded = load({ [GLOBAL]: { statusline: { separator: " | " } } })
    expect(loaded.config.separator).toBeUndefined()
    expect(loaded.notices).toEqual(['settings: "statusline" is no longer read — run /cockpit-setup'])
  })

  test("keys at the file's root are not Status's, and say where they belong", () => {
    const loaded = load({ [GLOBAL]: { enabled: false, debug: true } })
    expect(loaded.config.enabled).toBeUndefined()
    expect(loaded.notices).toContain(
      'settings: "enabled" at the top level is not read: it belongs in "status"',
    )
  })

  test("a bay-level `maxRows` is `sidebarRows` now; inside `lines` it is still `maxRows`", () => {
    const loaded = load({ [GLOBAL]: { status: { maxRows: 4, lines: [{ surface: "sidebar", maxRows: 3 }] } } })
    expect(loaded.notices).toEqual(['settings: "status.maxRows" is no longer read — run /cockpit-setup'])
    expect(resolveLines(loaded.config)[0]?.maxRows).toBe(3)
  })

  test("`sidebarOrder` is the top-level `sidebar` list now", () => {
    const loaded = load({ [GLOBAL]: { status: { sidebarOrder: 120 } } })
    expect(loaded.notices).toEqual(['settings: "status.sidebarOrder" is no longer read — run /cockpit-setup'])
  })
})

/** Status is the one bay every install draws, so the notices that belong to no bay are its to draw. */
describe("notices that belong to no bay", () => {
  test("a top-level name nothing reads is drawn here", () => {
    expect(load({ [GLOBAL]: { wobble: 1 } }).notices).toEqual(['settings: "wobble" is not a setting'])
  })

  test("as is a `sidebar` entry that is not a bay", () => {
    const loaded = load({ [GLOBAL]: { sidebar: ["status", "panels"] } })
    expect(loaded.notices).toHaveLength(1)
    expect(loaded.notices[0]).toContain('"panels" in "sidebar" is not a bay')
  })

  test("another bay's own notice is that bay's to draw, not this one's", () => {
    expect(load({ [GLOBAL]: { trust: { sidebarOrder: 1 } } }).notices).toEqual([])
  })
})

describe("precedence", () => {
  test("the project file beats the global one, and plugin options beat both", () => {
    const files = {
      [GLOBAL]: { status: { separator: " ~ ", segments: ["version"] } },
      [PROJECT]: { status: { separator: " | " } },
    }
    expect(load({ [GLOBAL]: files[GLOBAL] }).config.separator).toBe(" ~ ")
    // The project overrides what it names and inherits what it does not.
    expect(load(files).config).toMatchObject({ separator: " | ", segments: ["version"] })
    // The plugin entry wins over both.
    expect(load(files, { separator: " / " }).config.separator).toBe(" / ")
  })

  // Listing segments in a project means "this line", not "these as well as the global ones".
  test("segments are replaced, not concatenated", () => {
    const loaded = load({
      [GLOBAL]: { status: { segments: ["cwd", "cost"] } },
      [PROJECT]: { status: { segments: ["model"] } },
    })
    expect(loaded.config.segments).toEqual(["model"])
  })

  test("commands from both sources are kept", () => {
    const loaded = load({
      [GLOBAL]: { status: { commands: { budget: { run: "a" } } } },
      [PROJECT]: { status: { commands: { pods: { run: "b" } } } },
    })
    expect(Object.keys(loaded.config.commands ?? {}).sort()).toEqual(["budget", "pods"])
  })

  test("modules from every source add up rather than replacing each other", () => {
    const loaded = load(
      { [GLOBAL]: { status: { modules: ["~/a.ts"] } }, [PROJECT]: { status: { modules: ["./b.ts"] } } },
      { modules: ["./c.ts"] },
    )
    expect(loaded.config.modules).toEqual(["~/a.ts", "./b.ts", "./c.ts"])
  })
})

describe("where it draws", () => {
  test("the sidebar, when nothing says otherwise", () => {
    expect(resolveLines(load({}).config)[0]?.surface).toBe("sidebar")
  })

  /** The switch every bay shares, in Status's words: off the sidebar means at the bottom. */
  test("`sidebar: false` means the bottom, with the bottom's own line", () => {
    const [line] = resolveLines(load({ [GLOBAL]: { status: { sidebar: false } } }).config)
    expect(line?.surface).toBe("bottom")
    expect(line?.segments).toEqual(DEFAULT_SEGMENTS)
  })

  test("`surface` says it in Status's words, and wins", () => {
    expect(load({ [GLOBAL]: { status: { sidebar: false, surface: "sidebar" } } }).config.surface).toBe(
      "sidebar",
    )
  })

  test("`sidebarRows` caps the column", () => {
    const loaded = load({ [GLOBAL]: { status: { sidebarRows: 5 } } })
    expect(resolveLines(loaded.config)[0]?.maxRows).toBe(5)
  })

  test("the block's place comes from the top-level `sidebar` list", () => {
    expect(load({}).order).toBeLessThan(load({ [GLOBAL]: { sidebar: ["trust", "shell", "status"] } }).order)
  })
})

/** What only Status can tell is wrong: its own vocabulary. A preset nothing answers to used to fall back in silence. */
describe("settings only Status can check", () => {
  test("a preset nothing answers to is a row, and the line still draws", () => {
    const loaded = load({ [GLOBAL]: { status: { preset: "sidebar-budget" } } })
    expect(loaded.notices).toEqual([
      'settings: no preset "sidebar-budget" (minimal, default, detailed, sidebar)',
    ])
    expect(resolveLines(loaded.config)[0]?.segments).toEqual(SIDEBAR_SEGMENTS)
  })

  test("so is one inside `lines`, and a surface that does not exist", () => {
    expect(configNotices({ lines: [{ preset: "nope" }, { surface: "top" as never }] })).toEqual([
      'settings: no preset "nope" (minimal, default, detailed, sidebar)',
      'settings: "status.lines[1].surface" is "sidebar" or "bottom"',
    ])
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
    expect(resolveLines({ preset: "default" })[0]?.surface).toBe("bottom")
  })

  /** Why a turn stalled is what OpenCode does not show; the sidebar keeps it when rows run out. */
  test("every preset says why a turn stalled, and the sidebar keeps it when rows run out", () => {
    for (const [name, preset] of Object.entries(PRESETS))
      expect(
        preset.segments.map((s) => asSegmentConfig(s).type),
        name,
      ).toContain("session.status")
    const line = resolveLines({ preset: "sidebar" })[0]
    const ctx = { ...FIXTURES.retrying.ctx, width: 34 }
    const built = buildSegments(ctx, (line?.segments ?? []).map(asSegmentConfig))
    const kept = fitColumn(built, 34, 3).segments.map((segment) => rowText(segment.runs))
    expect(kept.some((row) => row.includes("retry 2"))).toBe(true)
  })

  test("anything written beside it wins", () => {
    const [line] = resolveLines({ preset: "minimal", separator: "  ", segments: ["cwd"] })
    expect(line?.separator).toBe("  ")
    expect(line?.segments).toEqual(["cwd"])
  })

  test("a name nothing answers to falls back to the surface's own line rather than drawing nothing", () => {
    expect(resolveLines({ preset: "nope" })[0]?.segments).toEqual(SIDEBAR_SEGMENTS)
    expect(resolveLines({ preset: "nope", surface: "bottom" })[0]?.segments).toEqual(DEFAULT_SEGMENTS)
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
  test("writing nothing gives the sidebar's table", () => {
    const [line] = resolveLines({})
    expect(line?.surface).toBe("sidebar")
    expect(line?.segments).toEqual(SIDEBAR_SEGMENTS)
    expect(line?.separator).toBe("")
  })

  test("the bottom with nothing else written gives the default line", () => {
    const [line] = resolveLines({ surface: "bottom" })
    expect(line?.segments).toEqual(DEFAULT_SEGMENTS)
    expect(line?.separator).toBe(DEFAULT_SEPARATOR)
  })

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
  test("the row cap and padding can be set once for every line", () => {
    const [line] = resolveLines({ surface: "sidebar", sidebarRows: 20, paddingLeft: 4 })
    expect(line?.maxRows).toBe(20)
    expect(line?.paddingLeft).toBe(4)
  })

  test("a line still overrides what the top level set", () => {
    const [line] = resolveLines({ sidebarRows: 20, lines: [{ surface: "sidebar", maxRows: 3 }] })
    expect(line?.maxRows).toBe(3)
  })

  test("the table's preset brings room for every row it has; another column keeps eight", () => {
    expect(resolveLines({})[0]?.maxRows).toBe(PRESETS.sidebar?.maxRows)
    expect(resolveLines({ surface: "sidebar", segments: ["cwd"], preset: "minimal" })[0]?.maxRows).toBe(8)
  })

  test("a bare string is that built-in with no settings", () => {
    expect(asSegmentConfig("cwd")).toEqual({ type: "cwd" })
    expect(asSegmentConfig({ type: "cwd", priority: 5 })).toEqual({ type: "cwd", priority: 5 })
  })
})

/**
 * Changing one row of the table used to mean copying all fourteen into `segments`, which then
 * stopped following the preset. `override` changes the rows it names and keeps the rest.
 */
describe("override", () => {
  const types = (config: StatusConfig, at = 0) =>
    resolveLines(config)[at]?.segments.map((entry) => asSegmentConfig(entry).type)
  const settingsOf = (config: StatusConfig, type: string) =>
    resolveLines(config)[0]
      ?.segments.map(asSegmentConfig)
      .find((entry) => entry.type === type)
  const sidebar = SIDEBAR_SEGMENTS.map((entry) => asSegmentConfig(entry).type)

  test("an object merges into that segment's settings, every other row kept", () => {
    expect(types({ override: { git: { against: "branch" } } })).toEqual(sidebar)
    expect(settingsOf({ override: { git: { against: "branch" } } }, "git")).toEqual({
      type: "git",
      against: "branch",
    })
    expect(settingsOf({ override: { "session.status": { working: true } } }, "session.status")).toEqual({
      type: "session.status",
      priority: 95,
      icon: "",
      working: true,
    })
  })

  test("false drops it — every segment of that name", () => {
    expect(types({ override: { write: false } })).toEqual(sidebar.filter((type) => type !== "write"))
    expect(types({ override: { sep: false } })).not.toContain("sep")
  })

  test("a name swaps it, in the same place", () => {
    const swapped = types({ override: { spend: "cost" } })
    expect(swapped?.indexOf("cost")).toBe(sidebar.indexOf("spend"))
    expect(swapped).not.toContain("spend")
  })

  test("it applies to the preset a line names, and to `segments` when they are written", () => {
    expect(types({ preset: "minimal", override: { diagnostics: false } })).toEqual([
      "context",
      "git.diff",
      "session.status",
    ])
    expect(types({ segments: ["cwd", "model"], override: { model: false } })).toEqual(["cwd"])
  })

  test("a line in `lines` takes its own, else the section's", () => {
    const config: StatusConfig = {
      override: { todo: false },
      lines: [
        { surface: "bottom", segments: ["cwd", "todo"] },
        { surface: "bottom", segments: ["cwd", "todo"], override: { cwd: false } },
      ],
    }
    expect(types(config, 0)).toEqual(["cwd"])
    expect(types(config, 1)).toEqual(["todo"])
  })

  test("read from the files, a project's override adds to the global one", () => {
    const loaded = load({
      [GLOBAL]: { status: { override: { git: { against: "branch" } } } },
      [PROJECT]: { status: { override: { write: false } } },
    })
    expect(loaded.notices).toEqual([])
    expect(types(loaded.config)).not.toContain("write")
    expect(settingsOf(loaded.config, "git")?.against).toBe("branch")
  })

  test("a name that matches no segment is a `!` row naming the closest", () => {
    expect(configNotices({ override: { gti: false } })).toEqual([
      'settings: override "gti" matches no segment in the sidebar preset — did you mean "git"?',
    ])
    expect(configNotices({ segments: ["cwd"], override: { model: false } })).toEqual([
      'settings: override "model" matches no segment in "segments"',
    ])
    expect(load({ [GLOBAL]: { status: { override: { gti: false } } } }).notices).toHaveLength(1)
  })

  test("a section-wide override is wrong only when it matches no line that uses it", () => {
    const lines: LineConfig[] = [
      { surface: "bottom", segments: ["cwd"] },
      { surface: "bottom", segments: ["todo"] },
    ]
    expect(configNotices({ override: { todo: false }, lines })).toEqual([])
    expect(configNotices({ lines: [{ segments: ["cwd"], override: { tood: false } }] })).toEqual([
      'settings: status.lines[0].override "tood" matches no segment in "segments"',
    ])
  })

  test("a change that is not one is said, and leaves the segment as it was", () => {
    const config = { override: { git: true } } as unknown as StatusConfig
    expect(configNotices(config)).toEqual([
      'settings: override "git" is false, a segment name, or an object of its settings',
    ])
    expect(types(config)).toEqual(sidebar)
  })

  test("not an object, it is dropped by the loader with a row naming the key", () => {
    const loaded = load({ [GLOBAL]: { status: { override: ["git"] } } })
    expect(loaded.config.override).toBeUndefined()
    expect(loaded.notices).toEqual(['settings: "status.override" should be an object; the default is used'])
  })
})
