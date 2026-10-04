/**
 * The report `cockpit_settings` answers from: every bay's state, read fresh through the same loader the
 * bays read with, so it says what the interface draws.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { bayKeys, type KeyInfo } from "../catalog.ts"
import { bayNotices, uniqueNotices } from "../checks.ts"
import {
  BAYS,
  type Bay,
  baySettings,
  closestName,
  loadSettings,
  OPTIONS_SOURCE,
  type Settings,
  type SettingsNotice,
  type SettingsWhere,
} from "../settings.ts"
import { type HostFile, hostFilePaths, readHostFile } from "./host-blocks.ts"
import {
  baysOfEntry,
  entryOptions,
  type Install,
  isObject,
  opencodeConfigPaths,
  readInstalls,
} from "./installs.ts"

export type Source = "default" | "global" | "project" | typeof OPTIONS_SOURCE

export interface ResolvedKey {
  info: KeyInfo
  value: unknown
  source: Source
}

export interface BayState {
  bay: Bay
  /** The entries that bring it, as written in OpenCode's files. */
  installs: Install[]
  /** Running on this agent side now (it claimed itself here). */
  running: boolean
  on: boolean
  /** Why it is off, in words, when it is. */
  off?: string
  keys: ResolvedKey[]
}

export interface SettingsReport {
  opencode: 1 | 2
  directory: string
  settings: Settings
  bays: BayState[]
  /**
   * Every notice: the files', each bay's own — what its block draws as a `!` row, from its own check
   * (`checks.ts`) — and keys no bay reads.
   */
  notices: SettingsNotice[]
  /** OpenCode's interface files, global first: what they say about its sidebar blocks. */
  host: HostFile[]
}

export interface ReportInput {
  opencode: 1 | 2
  directory: string
  /** Feature claims on this agent side: `{ shell: "opencode-cockpit", setup: … }`. Non-bays ignored. */
  claims?: ReadonlyMap<string, string>
  env?: Readonly<Record<string, string | undefined>>
  home?: string
  /** A file's text, or undefined when there is none — Cockpit's files and OpenCode's alike. */
  read?: (path: string) => string | undefined
}

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function settingsReport(input: ReportInput): SettingsReport {
  const env = input.env ?? process.env
  const home = input.home ?? homedir()
  const read = input.read ?? readText
  const where: SettingsWhere = { directory: input.directory, env, home, read }
  const settings = loadSettings(where)
  const installs = opencodeConfigPaths(input.opencode, input.directory, env, home).flatMap((path) =>
    readInstalls(path, read(path)),
  )
  const notices = [...settings.notices]

  const bays = BAYS.map((bay): BayState => {
    const mine = installs.filter((install) => baysOfEntry(install.entry).includes(bay))
    const running = input.claims?.has(bay) ?? false
    /** Every entry's options for it, later files winning: the interface's entry and the agent side's. */
    const given = mine.flatMap((install) => entryOptions(bay, install) ?? [])
    const options = given.length > 0 ? Object.assign({}, ...given) : undefined
    const infos = bayKeys(bay)
    const defaults = Object.fromEntries(infos.map((info) => [info.key, info.default]))
    const loaded = baySettings(bay, defaults, { settings, ...(options ? { options } : {}) })
    /** What the bay itself draws: its keys' kinds, and what only it knows (Status's presets…). */
    notices.push(...bayNotices(bay, settings, options))

    /** Keys a section carries that this bay never reads: a typo is silence otherwise. */
    const known = infos.map((info) => info.key)
    const sources = [
      ...settings.layers.map((layer) => ({
        source: layer.scope as Source,
        file: layer.path,
        section: layer.sections[bay] ?? {},
      })),
      ...(options ? [{ source: OPTIONS_SOURCE as Source, file: OPTIONS_SOURCE, section: options }] : []),
    ]
    for (const { file, section, source } of sources) {
      for (const key of Object.keys(section)) {
        if (known.includes(key)) continue
        /** Compared without case: keys are camelCase, and `hideWhenEmty` should still find its key. */
        const lowered = closestName(
          key,
          known.map((each) => each.toLowerCase()),
        )
        const meant = known.find((each) => each.toLowerCase() === lowered)
        const name = source === OPTIONS_SOURCE ? key : `${bay}.${key}`
        notices.push({
          bay,
          file,
          kind: "unread",
          old: name,
          ...(meant ? { new: source === OPTIONS_SOURCE ? meant : `${bay}.${meant}` } : {}),
          text: `"${name}" is not a setting of ${bay}${meant ? `: did you mean "${meant}"?` : ""}`,
        })
      }
    }

    const config = loaded.config as unknown as Record<string, unknown>
    const keys = infos.map((info): ResolvedKey => {
      /** The last source that wrote it, if what it wrote is what the bay uses (a wrong kind is dropped). */
      const from = [...sources].reverse().find(({ section }) => info.key in section)
      const value = config[info.key]
      const kept = from !== undefined && (same(from.section[info.key], value) || isObject(value))
      return { info, value, source: kept ? from.source : "default" }
    })
    const enabled = config.enabled !== false
    const off =
      mine.length === 0 && !running
        ? "not installed"
        : settings.features[bay] === false
          ? "`features` in a settings file"
          : mine.some(
                (install) =>
                  install.bundle &&
                  isObject(install.options) &&
                  isObject(install.options.features) &&
                  install.options.features[bay] === false,
              )
            ? "`features` in the plugin entry"
            : !enabled
              ? "`enabled: false`"
              : undefined
    return { bay, installs: mine, running, on: off === undefined, ...(off ? { off } : {}), keys }
  })

  return {
    opencode: input.opencode,
    directory: input.directory,
    settings,
    bays,
    notices: uniqueNotices(notices),
    host: hostFilePaths(input.opencode, input.directory, env, home).map((path) =>
      readHostFile(input.opencode, path, read(path)),
    ),
  }
}
