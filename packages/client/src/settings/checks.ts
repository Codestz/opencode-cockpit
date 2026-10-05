/**
 * Every notice the bays draw, for what reports on the settings without being a bay: `cockpit_settings`
 * and doctor. "Notices: none" there has to mean no `!` row in any block after a restart.
 *
 * The loader knows the files, the old names and the shared keys; it does not know a bay's own words.
 * So each bay's notices come from the bay: its keys' kinds through the loader with its defaults (the
 * catalog's, which a test holds equal to every bay's own), and — where a bay checks more than kinds,
 * as Status does its presets, surfaces and overrides — its own check, offered here the way a bay
 * offers its preview. Shared on `globalThis`: the bundle and a standalone package each carry a copy.
 *
 * Node APIs only: doctor runs this under `npx`.
 */

import { bayKeys } from "./catalog.ts"
import { BAYS, type Bay, baySettings, type Settings, type SettingsNotice } from "./index.ts"

/** A bay's own check: every notice it draws for these settings and its plugin options. Pure. */
export type SettingsCheck = (input: { settings: Settings; options?: unknown }) => SettingsNotice[]

const CHECKS = Symbol.for("opencode-cockpit.settings-checks")
const registry = (): Map<Bay, SettingsCheck> => {
  const shared = globalThis as { [CHECKS]?: Map<Bay, SettingsCheck> }
  shared[CHECKS] ??= new Map()
  return shared[CHECKS]
}

/** A bay offers its check: Status's agent side does, and the bundle's doctor. */
export function offerSettingsCheck(bay: Bay, check: SettingsCheck): void {
  registry().set(bay, check)
}

/** One notice once: the loader's are in every bay's list too. */
export function uniqueNotices(notices: readonly SettingsNotice[]): SettingsNotice[] {
  const seen = new Set<string>()
  return notices.filter((notice) => {
    const key = `${notice.bay}\0${notice.file}\0${notice.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Every notice one bay draws: the loader's for it, its keys' kinds, and its own check's. */
export function bayNotices(
  bay: Bay,
  settings: Settings,
  options?: unknown,
  check: SettingsCheck | undefined = registry().get(bay),
): SettingsNotice[] {
  const defaults = Object.fromEntries(bayKeys(bay).map((info) => [info.key, info.default]))
  const kinds = baySettings(bay, defaults, { settings, ...(options !== undefined ? { options } : {}) })
  let own: SettingsNotice[] = []
  try {
    own = check?.({ settings, ...(options !== undefined ? { options } : {}) }) ?? []
  } catch {
    /** A check that throws says nothing: the report is worth more than one bay's word. */
  }
  return uniqueNotices([...kinds.notices, ...own])
}

/** Every notice: the ones that belong to no bay, then each bay's. `options` by bay, as each entry has them. */
export function everyNotice(
  settings: Settings,
  options: Partial<Record<Bay, unknown>> = {},
): SettingsNotice[] {
  return uniqueNotices([
    ...settings.notices,
    ...BAYS.flatMap((bay) => bayNotices(bay, settings, options[bay])),
  ])
}
