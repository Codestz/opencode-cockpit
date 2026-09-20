import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveLines } from "../src/core/config.ts"
import { buildReport, reportHeadline } from "../src/core/report.ts"

/**
 * `/statusline` exists to answer the one question the screen cannot: a quiet line looks the same
 * whether there was nothing to report or the config never arrived. So the report has to be right
 * about the empty cases, not only the working one.
 */

const directory = join(tmpdir(), "ck-report-project")
const env = { HOME: join(tmpdir(), "ck-report-home"), XDG_CONFIG_HOME: undefined }

const report = (over: Parameters<typeof buildReport>[0] extends infer T ? Partial<T> : never = {}) =>
  buildReport({
    version: "9.9.9",
    directory,
    lines: resolveLines({ preset: "default" }),
    registered: 0,
    errors: [],
    env,
    ...over,
  })

describe("what it found", () => {
  test("names both config files, and says neither is there", () => {
    const found = report()
    expect(found.sources).toHaveLength(2)
    expect(found.sources[0]?.path).toContain(join(".config", "opencode-cockpit", "config.json"))
    expect(found.sources[1]?.path).toBe(join(directory, ".cockpit.json"))
    expect(found.sources.every((source) => source.found)).toBe(false)
  })

  test("a column reports the row cap; a line across has none to report", () => {
    const column = report({ lines: resolveLines({ preset: "sidebar" }) })
    expect(column.lines[0]).toMatchObject({ surface: "sidebar", stack: "vertical" })
    expect(column.lines[0]?.maxRows).toBeGreaterThan(0)
    expect(report().lines[0]?.maxRows).toBeUndefined()
  })

  test("modules are reported as listed against registered, which is the pair that shows a miss", () => {
    const withModule = report({ modules: ["./segments.ts"], registered: 4 })
    expect(withModule.modules).toMatchObject({ listed: ["./segments.ts"], registered: 4 })
  })
})

describe("the headline", () => {
  test("a module failure outranks everything else — its segments are simply missing", () => {
    const broken = report({ modules: ["./x.ts"], errors: ["./x.ts: Cannot find module 'foo'"] })
    expect(reportHeadline(broken)).toContain("1 module failed to load")
  })

  test("with no config file at all it says the line is the defaults, not that it is broken", () => {
    expect(reportHeadline(report())).toContain("neither config file exists")
  })

  test("nothing configured says exactly that, rather than counting zero segments", () => {
    expect(reportHeadline(report({ lines: [] }))).toContain("Nothing is drawing")
  })

  test("a working line counts its segments and names the surfaces", () => {
    // A found config file is what takes it off the defaults message; the project file will do.
    const running = { ...report(), sources: [{ path: "/w/.cockpit.json", found: true }] }
    expect(reportHeadline(running)).toMatch(/^\d+ segments across the bottom$/)
  })
})
