import { describe, expect, test } from "bun:test"
import { asSegmentConfig, SIDEBAR_SEGMENTS } from "../src/core/config.ts"
import { FIXTURES } from "../src/core/fixtures.ts"
import {
  drawState,
  parseArgs,
  plainRuns,
  previewSettings,
  roomFor,
  SIDEBAR_WIDTH,
} from "../src/core/preview.ts"

/** A `--config` file, read as the global one with nothing beside it: as the CLI reads it. */
const preview = (file: unknown, surface?: "sidebar" | "bottom") =>
  previewSettings({
    directory: "/w/app",
    env: { XDG_CONFIG_HOME: "/cfg" },
    configText: typeof file === "string" ? file : JSON.stringify(file),
    ...(surface ? { surface } : {}),
  })

const draw = (
  file: unknown,
  options: { debug?: boolean; state?: keyof typeof FIXTURES; surface?: "sidebar" | "bottom" } = {},
) => {
  const { loaded, lines } = preview(file, options.surface)
  return drawState({
    lines,
    troubles: loaded.notices,
    fixture: FIXTURES[options.state ?? "busy"],
    terminal: 120,
    debug: options.debug ?? false,
    paint: plainRuns,
    dim: (text) => text,
  })
}

describe("the flags", () => {
  test("`--name value` and `--name=value` alike", () => {
    expect(parseArgs(["preview", "--config", "a.json", "--state=full", "--debug"])).toEqual({
      values: { config: "a.json", state: "full" },
      switches: new Set(["debug"]),
      errors: [],
    })
  })

  /** Dropped in silence, a flag meant for one file drew the user's own settings instead. */
  test("an unknown flag, a missing value or a surface that is not one is an error", () => {
    expect(parseArgs(["--cofig", "a.json"]).errors).toEqual([
      "no flag --cofig — try --help",
      '"a.json" is not a flag — try --help',
    ])
    expect(parseArgs(["--config", "--debug"])).toMatchObject({ errors: ["--config needs a value"] })
    expect(parseArgs(["--config", "--debug"]).switches.has("debug")).toBe(true)
    expect(parseArgs(["--surface", "prompt"]).errors).toEqual([
      '--surface is sidebar or bottom, not "prompt"',
    ])
  })
})

describe("--config reads a file as OpenCode will", () => {
  test("the sidebar preset is the sidebar table, with its own room for every row", () => {
    const [line] = preview({ status: { preset: "sidebar" } }).lines
    expect(line?.surface).toBe("sidebar")
    expect(line?.stack).toBe("vertical")
    expect(line?.segments).toEqual(SIDEBAR_SEGMENTS)
    expect(line?.maxRows).toBe(14)
  })

  test("`sidebarRows` is the column's cap, above the preset's and below it", () => {
    expect(preview({ status: { preset: "sidebar", sidebarRows: 14 } }).lines[0]?.maxRows).toBe(14)
    expect(preview({ status: { preset: "sidebar", sidebarRows: 20 } }).lines[0]?.maxRows).toBe(20)
    const rows = draw({ status: { preset: "sidebar", sidebarRows: 3 } })
    expect(rows.at(-1)).toMatch(/dropped — sidebarRows is 3$/)
  })

  test("comments, `override` and its notices, exactly as the TUI reads them", () => {
    const { loaded, lines } = preview(
      '{\n  // just git\n  "status": { "override": { "git": { "against": "branch" }, "gti": false } },\n}',
    )
    const git = lines[0]?.segments.map(asSegmentConfig).find((entry) => entry.type === "git")
    expect(git?.against).toBe("branch")
    expect(lines[0]?.segments).toHaveLength(SIDEBAR_SEGMENTS.length)
    expect(loaded.notices).toEqual([
      'settings: override "gti" matches no segment in the sidebar preset — did you mean "git"?',
    ])
  })

  test("`sidebar: false` is the line under the prompt", () => {
    expect(preview({ status: { sidebar: false } }).lines[0]?.surface).toBe("bottom")
  })
})

describe("--surface", () => {
  test("draws there whatever the settings say, with that surface's preset and notices", () => {
    const moved = preview({ status: { sidebar: false, override: { git: false } } }, "sidebar")
    expect(moved.lines[0]?.surface).toBe("sidebar")
    expect(moved.lines[0]?.stack).toBe("vertical")
    expect(moved.loaded.notices).toEqual([])
    const down = preview({ status: { override: { git: false } } }, "bottom")
    expect(down.lines[0]?.surface).toBe("bottom")
    expect(down.loaded.notices).toEqual([
      'settings: override "git" matches no segment in the default preset — did you mean "git.diff"?',
    ])
  })

  test("moves every line in `lines`", () => {
    const { lines } = preview(
      { status: { lines: [{ surface: "bottom" }, { surface: "sidebar" }] } },
      "sidebar",
    )
    expect(lines.map((line) => line.surface)).toEqual(["sidebar", "sidebar"])
  })
})

describe("the room", () => {
  test("the sidebar is as wide as OpenCode's, not the terminal; the bottom is the terminal's", () => {
    const [side] = preview({}).lines
    const [bottom] = preview({ status: { sidebar: false } }).lines
    expect(side && roomFor(side, 200)).toBe(SIDEBAR_WIDTH)
    expect(SIDEBAR_WIDTH).toBe(34)
    expect(bottom && roomFor(bottom, 200)).toBe(195)
    expect(side && roomFor(side, 200, 50)).toBe(50)
    expect(draw({})[0]).toBe("  sidebar, 34 cols")
  })
})

/**
 * `⟨?title⟩` and `⟨todo⟩` meant "no such segment" and "drew nothing", one character apart inside the
 * same brackets. Each is a glyph of its own now, and readable without colour.
 */
describe("--debug", () => {
  test("✓ beside a row that drew, ✗ for one that said nothing, ? for a name nothing answers to", () => {
    const rows = draw({ status: { segments: ["title", "spend", "nope"] } }, { debug: true })
    expect(rows).toEqual([
      "  sidebar, 34 cols",
      `  Context${" ".repeat(34 - "Context".length + 2)}✓title`,
      "  ✗spend",
      "  ?nope",
    ])
  })

  test("across a line, the marks follow it in order", () => {
    const rows = draw({ status: { sidebar: false, segments: ["todo", "spend", "nope"] } }, { debug: true })
    expect(rows.slice(1)).toEqual(["  ▤ 2/5 todo │ ✗spend │ ?nope", "  ✓todo ✗spend ?nope"])
  })

  test("off, a silent segment draws nothing at all", () => {
    expect(draw({ status: { segments: ["title", "spend", "nope"] } })).toEqual([
      "  sidebar, 34 cols",
      "  Context",
    ])
  })
})
