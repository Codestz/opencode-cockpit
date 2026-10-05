/** Status's settings read through the loader every bay shares, and its notices as `cockpit_settings` lists them. */

import {
  baySettings,
  cockpitNotices,
  noticeText,
  OPTIONS_SOURCE,
  type Settings,
  type SettingsNotice,
  type SettingsWhere,
} from "@opencode-cockpit/client/settings"
import { configNotices, configProblems, type StatusProblem } from "./problems.ts"
import { isObject, KINDS, type StatusConfig } from "./shape.ts"

export interface LoadedStatus {
  /** Every source merged, as written: the gaps are `resolveLines`'s to fill. */
  config: StatusConfig
  /** The block's place in the sidebar, from the top-level `sidebar` list. */
  order: number
  /**
   * What to fix, one `!` row each: Status's own settings, and — because Status is the one bay every
   * install draws — the notices that belong to no bay (a file that would not parse, a top-level
   * name nothing reads, an entry in the `sidebar` list that is not a bay).
   */
  notices: string[]
  settings: Settings
}

export interface StatusInput {
  /** The plugin entry's options: the section's own keys, or a whole config with a `status` section. */
  options?: unknown
  where?: SettingsWhere
  /** Already loaded, as `cockpit_settings` and doctor have them. */
  settings?: Settings
}

/** Reads and merges every source. Never throws. */
export function loadStatus(input: StatusInput = {}): LoadedStatus {
  const loaded = baySettings("status", KINDS, {
    options: input.options,
    ...(input.settings ? { settings: input.settings } : { where: input.where }),
  })
  const written = loaded.written as StatusConfig
  const config: StatusConfig = { ...written }
  /** `features.status: false` turns the bay off as `enabled: false` does. */
  if (!loaded.config.enabled) config.enabled = false
  /** The shared switch, in Status's words: off the sidebar means at the bottom. */
  if (written.sidebar === false && written.surface === undefined) config.surface = "bottom"
  if (typeof written.sidebarRows === "number") config.sidebarRows = loaded.config.sidebarRows
  /**
   * Modules add up rather than replace: a project can bring its own segments without losing the ones
   * you use everywhere. Every other list replaces the one before it, as in every bay.
   */
  const modules = [
    ...loaded.settings.layers.flatMap((layer) => strings(layer.sections.status?.modules)),
    ...strings(optionsSection(input.options)?.modules),
  ]
  if (modules.length > 0) config.modules = [...new Set(modules)]
  else delete config.modules

  const own = [...cockpitNotices(loaded.settings), ...loaded.notices].map(noticeText)
  return {
    config,
    order: loaded.order,
    notices: [...own, ...configNotices(config)],
    settings: loaded.settings,
  }
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : []

/** Plugin options as the section: a whole config's `status`, else the options themselves. */
function optionsSection(options: unknown): Record<string, unknown> | undefined {
  if (!isObject(options)) return undefined
  return isObject(options.status) ? options.status : options
}

/**
 * Every notice Status draws for these settings, as notices — the loader's, its own keys' kinds, and
 * its vocabulary's — each naming the file its key was written in. Offered to `cockpit_settings` and
 * doctor (`offerSettingsCheck`), so "Notices: none" there means no `!` row here.
 */
export function statusNotices(input: { settings: Settings; options?: unknown }): SettingsNotice[] {
  const loaded = loadStatus({ options: input.options, settings: input.settings })
  const options = optionsSection(input.options)
  /** The last source that wrote the key: plugin options win, then the project file, then the global. */
  const fileOf = (key: StatusProblem["key"]) =>
    options && key in options
      ? OPTIONS_SOURCE
      : ([...input.settings.layers]
          .reverse()
          .find((layer) => layer.sections.status && key in layer.sections.status)?.path ?? "status")
  const own = baySettings("status", KINDS, { options: input.options, settings: input.settings }).notices
  return [
    ...own,
    ...configProblems(loaded.config).map(
      (problem): SettingsNotice => ({
        bay: "status",
        file: fileOf(problem.key),
        kind: "invalid",
        text: problem.text,
      }),
    ),
  ]
}
