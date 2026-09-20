import { describe, expect, test } from "bun:test"
import { resolveLines } from "../src/core/config.ts"
import { statuslineBrief, targetConfig } from "../src/core/instructions.ts"
import { buildReport } from "../src/core/report.ts"

/**
 * `/statusline` sends this to the agent instead of drawing a panel. It is worth testing as a string
 * because the whole value of it is the part an agent cannot look up: which file to edit, and what
 * is in it right now.
 */

const base = (over: Record<string, unknown> = {}) =>
  buildReport({
    version: "1.2.3",
    directory: "/w/app",
    lines: resolveLines({ preset: "default" }),
    registered: 0,
    errors: [],
    env: { HOME: "/home/u", XDG_CONFIG_HOME: undefined },
    ...over,
  })

describe("which file to edit", () => {
  test("the project's when it exists, because that is the one this repo reads", () => {
    const report = base()
    report.sources[1] = { path: "/w/app/.cockpit.json", found: true }
    expect(targetConfig(report)).toMatchObject({ path: "/w/app/.cockpit.json", exists: true })
  })

  test("otherwise the global one, and the brief says it has to be created", () => {
    expect(statuslineBrief(base())).toContain("does not exist yet")
  })
})

describe("what it tells the agent", () => {
  test("names the surfaces drawing now, so it does not have to guess", () => {
    expect(statuslineBrief(base())).toMatch(/Drawing now: bottom \(horizontal\), \d+ segments/)
  })

  test("carries the built-in names and the presets, which are otherwise only on a website", () => {
    const brief = statuslineBrief(base())
    expect(brief).toContain("git.branch")
    expect(brief).toContain('"preset": "minimal"')
  })

  test("a module that would not load is stated, not left to be rediscovered", () => {
    const brief = statuslineBrief(base({ modules: ["./x.ts"], errors: ["./x.ts: no such file"] }))
    expect(brief).toContain("./x.ts: no such file")
  })

  test("points at the skill and insists the result is looked at before it is called done", () => {
    const brief = statuslineBrief(base())
    expect(brief).toContain("skills/statusline-design/SKILL.md")
    expect(brief).toContain("preview --watch")
  })

  test("ends by asking what I want, so it does not redesign the line unprompted", () => {
    expect(statuslineBrief(base()).trimEnd().endsWith("before you edit anything.")).toBe(true)
  })
})
