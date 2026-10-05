import { afterEach, expect, test } from "bun:test"
import { offerSettingsCheck } from "@opencode-cockpit/client/checks"
import { loadSettings } from "@opencode-cockpit/client/settings"
import { settingsReport, settingsText } from "@opencode-cockpit/client/setup"
import { loadStatus, statusNotices } from "../src/core/config/index.ts"

/**
 * Status offers its own check to `cockpit_settings` (and doctor), so what its line warns about is
 * listed there too — the audit's "Notices: none" while the sidebar still said `override "gti"`.
 */

const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"
const PROJECT = "/work/app/.cockpit.json"
const OPENCODE = "/home/me/.config/opencode/opencode.json"
const CHECKS = Symbol.for("opencode-cockpit.settings-checks")

afterEach(() => {
  ;(globalThis as { [CHECKS]?: Map<string, unknown> })[CHECKS]?.clear()
})

const reader = (files: Record<string, unknown>) => (path: string) => {
  const all: Record<string, unknown> = { [OPENCODE]: { plugins: ["opencode-cockpit@0.9.0"] }, ...files }
  return all[path] === undefined ? undefined : JSON.stringify(all[path])
}
const where = (files: Record<string, unknown>) => ({
  directory: "/work/app",
  env: {},
  home: "/home/me",
  read: reader(files),
})

test("cockpit_settings lists Status's override and Trust's threshold; fixed, it says none", () => {
  offerSettingsCheck("status", statusNotices)
  const report = (files: Record<string, unknown>) =>
    settingsText(settingsReport({ opencode: 2, ...where(files) }))

  const broken = report({ [GLOBAL]: { status: { override: { gti: false } }, trust: { threshold: "3" } } })
  expect(broken.split("\n")[2]).toBe("## Fix these first (2)")
  expect(broken).toContain(
    `- ${GLOBAL}: override "gti" matches no segment in the sidebar preset — did you mean "git"?\n`,
  )
  expect(broken).toContain(`- ${GLOBAL}: "trust.threshold" should be a number; the default is used.`)

  const fixed = report({ [GLOBAL]: { status: { override: { git: false } }, trust: { threshold: 3 } } })
  expect(fixed.split("\n")[2]).toBe("Notices: none. Every setting written is read.")
})

test("statusNotices says what the line draws, as notices naming the file the key is in", () => {
  const files = {
    [GLOBAL]: { status: { preset: "nope" } },
    [PROJECT]: { status: { override: { gti: false }, surface: "top" } },
  }
  const settings = loadSettings(where(files))
  const notices = statusNotices({ settings })
  expect(notices.map((notice) => [notice.file, notice.text])).toEqual([
    [GLOBAL, expect.stringContaining('no preset "nope"')],
    [PROJECT, '"status.surface" is "sidebar" or "bottom"'],
    [PROJECT, expect.stringContaining('override "gti" matches no segment')],
  ])
  /** The same set as the `!` rows the bay draws, word for word. */
  const drawn = loadStatus({ where: where(files) }).notices
  expect(notices.map((notice) => `settings: ${notice.text}`)).toEqual(drawn)
})

test("plugin options are the file for a key written there", () => {
  const settings = loadSettings(where({}))
  const notices = statusNotices({ settings, options: { preset: "nope" } })
  expect(notices.map((notice) => notice.file)).toEqual(["plugin options"])
})
