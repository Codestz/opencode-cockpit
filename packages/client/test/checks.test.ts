import { afterEach, describe, expect, test } from "bun:test"
import {
  bayNotices,
  everyNotice,
  offerSettingsCheck,
  type SettingsCheck,
  uniqueNotices,
} from "../src/settings/checks.ts"
import { loadSettings, type SettingsNotice } from "../src/settings/index.ts"
import { settingsReport, settingsText } from "../src/setup/index.ts"

/**
 * "Notices: none" from `cockpit_settings` has to mean no `!` row in any block. The audit's case: the
 * agent fixed what the loader saw and said "none", and after a restart Status still warned about an
 * override matching no segment and Trust about a threshold written as a string — notices only the
 * bays drew.
 */

const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"
const OPENCODE = "/home/me/.config/opencode/opencode.json"
const CHECKS = Symbol.for("opencode-cockpit.settings-checks")

afterEach(() => {
  ;(globalThis as { [CHECKS]?: Map<string, SettingsCheck> })[CHECKS]?.clear()
})

const files = (cockpit: unknown) => {
  const all: Record<string, unknown> = {
    [OPENCODE]: { plugins: ["opencode-cockpit@0.9.0"] },
    [GLOBAL]: cockpit,
  }
  return (path: string) => (all[path] === undefined ? undefined : JSON.stringify(all[path]))
}
const where = (cockpit: unknown) => ({
  directory: "/work/app",
  env: {},
  home: "/home/me",
  read: files(cockpit),
})
const report = (cockpit: unknown) =>
  settingsText(
    settingsReport({ opencode: 2, directory: "/work/app", env: {}, home: "/home/me", read: files(cockpit) }),
  )

/** Stands in for Status's own check (`statusNotices`), which this package cannot import. */
const statusCheck: SettingsCheck = ({ settings }) => {
  const override = settings.sections.status.override as Record<string, unknown> | undefined
  return Object.keys(override ?? {})
    .filter((name) => name === "gti")
    .map((name) => ({
      bay: "status",
      file: GLOBAL,
      kind: "invalid",
      text: `override "${name}" matches no segment in the sidebar preset — did you mean "git"?`,
    }))
}

describe("cockpit_settings lists what the bays draw", () => {
  const broken = { status: { override: { gti: false } }, trust: { threshold: "3" } }

  test("a bay's own word (Status's override) and a key of the wrong kind (Trust's threshold)", () => {
    offerSettingsCheck("status", statusCheck)
    const text = report(broken)
    expect(text).toContain("## Fix these first (2)")
    expect(text).toContain(`- ${GLOBAL}: override "gti" matches no segment in the sidebar preset`)
    expect(text).toContain(`- ${GLOBAL}: "trust.threshold" should be a number; the default is used.`)
    expect(text.split("\n")[2]).toBe("## Fix these first (2)")
  })

  test("fixed, it says none", () => {
    offerSettingsCheck("status", statusCheck)
    expect(report({ status: { override: { git: false } }, trust: { threshold: 3 } }).split("\n")[2]).toBe(
      "Notices: none. Every setting written is read.",
    )
  })

  test("a bay that offered no check still has its keys' kinds checked", () => {
    expect(report(broken)).toContain('"trust.threshold" should be a number')
  })
})

describe("bayNotices", () => {
  test("each notice once: the loader's are in the bay's list too", () => {
    const settings = loadSettings(where({ status: { maxRows: 3 } }))
    const notices = bayNotices("status", settings, undefined, ({ settings }) => settings.notices)
    expect(notices.filter((notice) => notice.text.includes("status.maxRows"))).toHaveLength(1)
  })

  test("plugin options are checked as the bay reads them", () => {
    const settings = loadSettings(where({}))
    expect(bayNotices("trust", settings, { threshold: "3" })).toEqual([
      {
        bay: "trust",
        file: "plugin options",
        kind: "invalid",
        old: "threshold",
        text: '"threshold" should be a number; the default is used',
      },
    ])
  })

  test("a check that throws costs only its own notices", () => {
    const settings = loadSettings(where({ trust: { threshold: "3" } }))
    const notices = bayNotices("trust", settings, undefined, () => {
      throw new Error("boom")
    })
    expect(notices.map((notice) => notice.text)).toEqual([
      '"trust.threshold" should be a number; the default is used',
    ])
  })
})

test("everyNotice: the ones that belong to no bay, then every bay's, each once", () => {
  offerSettingsCheck("status", statusCheck)
  const settings = loadSettings(where({ statusbar: {}, ...{ status: { override: { gti: false } } } }))
  const texts = everyNotice(settings).map((notice) => notice.text)
  expect(texts[0]).toContain('"statusbar" is not a setting')
  expect(texts.some((text) => text.startsWith('override "gti"'))).toBe(true)
  expect(new Set(texts).size).toBe(texts.length)
})

test("uniqueNotices keeps the first of each", () => {
  const one: SettingsNotice = { bay: "trust", file: GLOBAL, kind: "invalid", text: "x" }
  expect(uniqueNotices([one, { ...one }, { ...one, file: "plugin options" }])).toHaveLength(2)
})
