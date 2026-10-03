/**
 * Cockpit's settings: one loader every bay reads through, so the files mean the same thing to all of
 * them, to doctor and to `cockpit_settings`.
 *
 *   ~/.config/opencode-cockpit/config.json   (or $XDG_CONFIG_HOME/…)
 *   <project>/.cockpit.json                   wins over the global file
 *   plugin-entry options                      win over both
 *
 * Each bay grew its own copy of that merge, and no two read the file the same way: Shell's keys sat at
 * the file's root, Status read the root as its own when it had no section, Subagents and Review read
 * no file at all, and every copy but the Updater's dropped a file with one comment in it without a
 * word (docs/opencode/settings-and-commands.md). Here:
 *
 * - **JSONC everywhere.** Comments and trailing commas are fine.
 * - **One section per bay** (`status`, `subagents`, `shell`, `trail`, `trust`, `review`, `updater`),
 *   merged key by key, nested objects included; a list replaces the one before it. A file without a
 *   bay's section says nothing about that bay — its root is never read as anyone's settings.
 * - **The same shared keys in every bay**, flat and spelled once: `enabled`, `keybinds`, `sidebar`
 *   (draw the block, a boolean), `sidebarRows`, `hideWhenEmpty`. Time keys carry their unit
 *   (`hideFinishedAfterMinutes`, `hideNestedAfterSeconds`).
 * - **One order**: the top-level `sidebar` list, and nothing else.
 * - **Old names are not read.** They are recognised, so each one is a notice — the bay draws it as a
 *   `!` row, doctor prints it, `cockpit_settings` lists it for the `cockpit-setup` skill to fix — and
 *   its value is ignored.
 * - **It never throws.** An unreadable file, a wrong type, an unknown name: a notice, and the
 *   defaults. A typo in a config should never cost you the interface.
 *
 * Read once, at start — never in a draw path. Node APIs only: doctor runs this under `npx`.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseJsonc } from "./jsonc.ts"

// ── Names ──────────────────────────────────────────────────────────────────────────────────────

/** Bays that draw a sidebar block, in the default order. The `sidebar` list is made of these. */
export const SIDEBAR_BAYS = ["status", "subagents", "shell", "trail", "trust"] as const
export type SidebarBay = (typeof SIDEBAR_BAYS)[number]

/** Every bay with a section in the file. */
export const BAYS = [...SIDEBAR_BAYS, "review", "updater"] as const
export type Bay = (typeof BAYS)[number]

export const isBay = (name: unknown): name is Bay => (BAYS as readonly unknown[]).includes(name)
export const isSidebarBay = (name: unknown): name is SidebarBay =>
  (SIDEBAR_BAYS as readonly unknown[]).includes(name)

/** The files, by where they are. */
export const GLOBAL_FILE = "config.json"
export const PROJECT_FILE = ".cockpit.json"

/** Where a notice from plugin-entry options says it came from. */
export const OPTIONS_SOURCE = "plugin options"

/** What every notice about an old name tells you to do. */
export const SETUP_COMMAND = "/cockpit-setup"

// ── The shape ──────────────────────────────────────────────────────────────────────────────────

/** Spelled the same in every bay. */
export interface SharedSettings {
  /** The bay's off switch, in every file. `features.<bay>: false` still works too. */
  enabled: boolean
  keybinds: Record<string, string>
  /** Draw the bay's sidebar block. A boolean here; the top-level `sidebar` is the order. */
  sidebar: boolean
  /** Rows before the rest fold into `+ N more`. */
  sidebarRows: number
  /** Draw nothing at all when there is nothing to list. Default false: the heading and `none yet`. */
  hideWhenEmpty: boolean
}

/**
 * What a bay starts from before any file is read. Every block is present by default except Trust's,
 * which is opt-in (the palette toggles it per session); Trail is a core piece and shows.
 */
export const SHARED_DEFAULTS: Readonly<Record<Bay, SharedSettings>> = {
  status: { enabled: true, keybinds: {}, sidebar: true, sidebarRows: 8, hideWhenEmpty: false },
  subagents: { enabled: true, keybinds: {}, sidebar: true, sidebarRows: 6, hideWhenEmpty: false },
  shell: { enabled: true, keybinds: {}, sidebar: true, sidebarRows: 5, hideWhenEmpty: false },
  trail: { enabled: true, keybinds: {}, sidebar: true, sidebarRows: 5, hideWhenEmpty: false },
  trust: { enabled: true, keybinds: {}, sidebar: false, sidebarRows: 3, hideWhenEmpty: false },
  review: { enabled: true, keybinds: {}, sidebar: false, sidebarRows: 0, hideWhenEmpty: false },
  updater: { enabled: true, keybinds: {}, sidebar: false, sidebarRows: 0, hideWhenEmpty: false },
}

type Kind = "boolean" | "number" | "string" | "object" | "array"

const SHARED_KIND: Readonly<Record<keyof SharedSettings, Kind>> = {
  enabled: "boolean",
  keybinds: "object",
  sidebar: "boolean",
  sidebarRows: "number",
  hideWhenEmpty: "boolean",
}

/** The whole file, as documented. Each bay types its own keys; these are the ones they share. */
export interface CockpitSettings {
  /** Top to bottom. Default: status, subagents, shell, trail, trust. */
  sidebar?: SidebarBay[]
  /** The bundle's switches, read from the files too. */
  features?: Partial<Record<Bay, boolean>>
  status?: Partial<SharedSettings> & Record<string, unknown>
  subagents?: Partial<SharedSettings> & Record<string, unknown>
  shell?: Partial<SharedSettings> & Record<string, unknown>
  trail?: Partial<SharedSettings> & Record<string, unknown>
  trust?: Partial<SharedSettings> & Record<string, unknown>
  review?: Partial<SharedSettings> & Record<string, unknown>
  updater?: { updateCheck?: boolean }
}

// ── Notices ────────────────────────────────────────────────────────────────────────────────────

export type NoticeKind =
  /** A name from before 0.9. Not read; `new` says what to write instead. */
  | "old"
  /** Not read: an unknown name, or a key in the wrong place. */
  | "unread"
  /** The right name with the wrong kind of value; the default is used. */
  | "invalid"
  /** A file that is not JSON(C); the whole file is ignored. */
  | "unreadable"

/**
 * Something about the settings worth fixing. `old` is the name as written, `new` the one to write
 * instead (when there is one). `text` says it in a sentence — `"statusline" is no longer read — run
 * /cockpit-setup` — for a bay's `!` row (`noticeText`) and doctor's fix line (`${file}: ${text}`).
 */
export interface SettingsNotice {
  /** The bay whose block should say it. `cockpit` belongs to no one bay: a file, the top level. */
  bay: Bay | "cockpit"
  /** The file it was found in, or `plugin options`. */
  file: string
  kind: NoticeKind
  old?: string
  new?: string
  text: string
}

/** The row a bay draws for a notice, after a `!` in the warning tone. */
export const noticeText = (notice: SettingsNotice): string => `settings: ${notice.text}`

// ── Old names ──────────────────────────────────────────────────────────────────────────────────
//
// Detection only, and removed in 0.10. Before 0.9 each bay had its own spellings; they are no longer
// read, only recognised, so a config written for 0.8 says what changed instead of silently doing
// nothing. Values under these keys are ignored.

/** Shell's keys that sat at the file's root before it had a section. */
const ROOT_SHELL = ["watch", "kinds", "defaults", "lifecycle", "notify", "guidance", "listRunningShells"]

/**
 * Root keys Status used to read as its own when the file had no section — so a root `enabled: false`
 * meant for something else turned the statusline off. A file's root is no bay's settings now.
 */
const ROOT_STATUS = [
  "enabled",
  "debug",
  "preset",
  "surface",
  "segments",
  "separator",
  "stack",
  "icons",
  "maxRows",
  "lines",
  "commands",
  "modules",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
]

/** Old keys inside a bay's section (and its plugin options), and what replaced them. Removed in 0.10. */
const OLD_IN_SECTION: Readonly<Partial<Record<Bay, Readonly<Record<string, string>>>>> = {
  status: { maxRows: "sidebarRows" },
  shell: { historyMinutes: "hideFinishedAfterMinutes" },
  subagents: { hideFinishedAfter: "hideFinishedAfterMinutes", hideNestedAfter: "hideNestedAfterSeconds" },
}

/** Shell's old `ui` group: where each key went. Anything not listed went to `shell.<key>`. Removed in 0.10. */
const OLD_UI: Readonly<Record<string, string>> = {
  historyMinutes: "shell.hideFinishedAfterMinutes",
  updateCheck: "updater.updateCheck",
  sidebarOrder: "sidebar",
}

/** Every old name the loader recognises, and what to write instead — for the `cockpit-setup` skill's reference. */
export const OLD_NAMES: readonly { old: string; new: string }[] = [
  { old: "statusline", new: "status" },
  { old: "status.maxRows", new: "status.sidebarRows" },
  ...ROOT_SHELL.map((key) => ({ old: key, new: `shell.${key}` })),
  { old: "ui.<key>", new: "shell.<key>" },
  { old: "ui.historyMinutes", new: "shell.hideFinishedAfterMinutes" },
  { old: "ui.updateCheck", new: "updater.updateCheck" },
  { old: "ui.sidebarOrder", new: "sidebar" },
  { old: "<bay>.sidebarOrder", new: "sidebar" },
  { old: "subagents.hideFinishedAfter", new: "subagents.hideFinishedAfterMinutes" },
  { old: "subagents.hideNestedAfter", new: "subagents.hideNestedAfterSeconds" },
]

const oldText = (old: string) => `"${old}" is no longer read — run ${SETUP_COMMAND}`

// ── Small helpers ──────────────────────────────────────────────────────────────────────────────

type Section = Record<string, unknown>

const isObject = (value: unknown): value is Section =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function kindOf(value: unknown): Kind | undefined {
  if (Array.isArray(value)) return "array"
  if (isObject(value)) return "object"
  if (typeof value === "number") return Number.isFinite(value) ? "number" : undefined
  if (typeof value === "boolean" || typeof value === "string") return typeof value as Kind
  return undefined
}

const article = (kind: Kind) => (kind === "array" ? "a list" : kind === "object" ? "an object" : `a ${kind}`)

/** Key by key, nested objects included; anything else — a list too — replaces what was there. */
export function mergeSections(base: Section, over: Section): Section {
  const out: Section = { ...base }
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue
    const before = out[key]
    out[key] = isObject(value) && isObject(before) ? mergeSections(before, value) : value
  }
  return out
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] as number
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number
      row[j] = Math.min(above + 1, (row[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length] as number
}

/** The valid name someone most likely meant: `shells` → `shell`, `statusline` → `status`. */
export function closestName(name: string, valid: readonly string[]): string | undefined {
  const lower = name.toLowerCase()
  const exact = valid.find((each) => each === lower)
  if (exact) return exact
  const prefix = valid.find((each) => lower.startsWith(each) || each.startsWith(lower))
  if (prefix && lower.length >= 3) return prefix
  let best: { name: string; cost: number } | undefined
  for (const each of valid) {
    const cost = distance(lower, each)
    if (!best || cost < best.cost) best = { name: each, cost }
  }
  return best && best.cost <= 2 ? best.name : undefined
}

// ── Reading the files ──────────────────────────────────────────────────────────────────────────

export interface SettingsWhere {
  /** The project directory, for its `.cockpit.json`. */
  directory?: string
  env?: Readonly<Record<string, string | undefined>>
  home?: string
  /** A file's text, or undefined when there is none. Doctor hands its own disk. */
  read?: (path: string) => string | undefined
}

export interface SettingsFile {
  path: string
  scope: "global" | "project"
  found: boolean
  /** Why it could not be used. The whole file is then ignored. */
  error?: string
}

/** One file that was read: its sections, old names already taken out. */
export interface SettingsLayer {
  path: string
  scope: "global" | "project"
  sections: Partial<Record<Bay, Section>>
  /** Its `sidebar` list, valid names only; undefined when it sets none. */
  sidebar?: SidebarBay[]
  features: Partial<Record<Bay, boolean>>
}

export interface Settings {
  /** Every file looked for, global first. */
  files: SettingsFile[]
  /** The files that were read, global first. */
  layers: SettingsLayer[]
  /** Each bay's section, global then project, before plugin options and defaults. */
  sections: Record<Bay, Section>
  /** The list as the user wrote it (project replaces global); undefined when neither sets one. */
  sidebarList?: SidebarBay[]
  /** The order the blocks draw in: the user's list, then every bay it left out, in default order. */
  sidebar: SidebarBay[]
  features: Partial<Record<Bay, boolean>>
  /** Everything to fix, from every file. A bay's own are also in `baySettings(…).notices`. */
  notices: SettingsNotice[]
}

export function settingsPaths(where: SettingsWhere = {}): { global: string; project?: string } {
  const env = where.env ?? process.env
  const base = env.XDG_CONFIG_HOME || join(where.home ?? homedir(), ".config")
  return {
    global: join(base, "opencode-cockpit", GLOBAL_FILE),
    ...(where.directory ? { project: join(where.directory, PROJECT_FILE) } : {}),
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/**
 * One bay's section with its old keys taken out, each one noted. `prefix` is how a key is named in
 * a notice: `shell.` in a file, nothing in plugin options (where the keys are the bay's own).
 */
function withoutOld(
  bay: Bay,
  section: Section,
  file: string,
  prefix: string,
  notes: SettingsNotice[],
): Section {
  const out: Section = {}
  const old = (name: string, now: string) =>
    notes.push({ bay, file, kind: "old", old: name, new: now, text: oldText(name) })
  for (const [key, value] of Object.entries(section)) {
    const now = OLD_IN_SECTION[bay]?.[key]
    if (key === "sidebarOrder") old(`${prefix}${key}`, "sidebar")
    else if (now) old(`${prefix}${key}`, `${bay}.${now}`)
    else if (bay === "shell" && key === "ui" && isObject(value)) {
      for (const inner of Object.keys(value)) old(`${prefix}ui.${inner}`, OLD_UI[inner] ?? `shell.${inner}`)
    } else if (key === "sidebar" && Array.isArray(value)) {
      notes.push({
        bay,
        file,
        kind: "unread",
        old: `${prefix}${key}`,
        new: "sidebar",
        text: `"${prefix}${key}" is a switch, true or false: the order is the top-level "sidebar" list`,
      })
    } else out[key] = value
  }
  return out
}

/** The shared keys of one section, type-checked: a wrong kind is dropped with a notice. */
function checkShared(
  bay: Bay,
  section: Section,
  file: string,
  prefix: string,
  notes: SettingsNotice[],
): Section {
  const out: Section = {}
  for (const [key, value] of Object.entries(section)) {
    const want = SHARED_KIND[key as keyof SharedSettings]
    if (want && kindOf(value) !== want) {
      notes.push({
        bay,
        file,
        kind: "invalid",
        old: `${prefix}${key}`,
        text: `"${prefix}${key}" should be ${article(want)}; the default is used`,
      })
      continue
    }
    out[key] = value
  }
  return out
}

const TOP = ["sidebar", "features", "$schema", ...BAYS] as const

function readSidebarList(value: unknown, file: string, notes: SettingsNotice[]): SidebarBay[] | undefined {
  if (value === undefined) return undefined
  const valid = SIDEBAR_BAYS.join(", ")
  if (!Array.isArray(value)) {
    notes.push({
      bay: "cockpit",
      file,
      kind: "invalid",
      old: "sidebar",
      text: `"sidebar" is the order of the blocks, a list: ["${SIDEBAR_BAYS.join('", "')}"]`,
    })
    return undefined
  }
  const list: SidebarBay[] = []
  for (const name of value) {
    if (isSidebarBay(name)) {
      if (!list.includes(name)) list.push(name)
      continue
    }
    const shown = typeof name === "string" ? name : JSON.stringify(name)
    if (isBay(name)) {
      notes.push({
        bay: name,
        file,
        kind: "unread",
        old: `sidebar: "${shown}"`,
        text: `"${shown}" in "sidebar" has no sidebar block (${valid})`,
      })
      continue
    }
    const meant = typeof name === "string" ? closestName(name, SIDEBAR_BAYS) : undefined
    notes.push({
      bay: (meant as SidebarBay | undefined) ?? "cockpit",
      file,
      kind: "unread",
      old: `sidebar: "${shown}"`,
      ...(meant ? { new: meant } : {}),
      text: `"${shown}" in "sidebar" is not a bay${meant ? `: did you mean "${meant}"?` : ""} (${valid})`,
    })
  }
  return list
}

function readFeatures(value: unknown, file: string, notes: SettingsNotice[]): Partial<Record<Bay, boolean>> {
  const out: Partial<Record<Bay, boolean>> = {}
  if (value === undefined) return out
  if (!isObject(value)) {
    notes.push({
      bay: "cockpit",
      file,
      kind: "invalid",
      old: "features",
      text: `"features" should be an object, like { "trust": false }`,
    })
    return out
  }
  for (const [name, on] of Object.entries(value)) {
    if (isBay(name) && typeof on === "boolean") {
      out[name] = on
      continue
    }
    const meant = isBay(name) ? undefined : closestName(name, BAYS)
    notes.push({
      bay: isBay(name) ? name : "cockpit",
      file,
      kind: isBay(name) ? "invalid" : "unread",
      old: `features.${name}`,
      ...(meant ? { new: `features.${meant}` } : {}),
      text: isBay(name)
        ? `"features.${name}" should be true or false`
        : `"features.${name}" is not a bay${meant ? `: did you mean "${meant}"?` : ""}`,
    })
  }
  return out
}

/** One parsed file into its sections; every old name and stray key noted, and left out. */
function readLayer(raw: Section, file: string, scope: SettingsLayer["scope"], notes: SettingsNotice[]) {
  const note = (notice: Omit<SettingsNotice, "file">) => notes.push({ file, ...notice })
  const sections: Partial<Record<Bay, Section>> = {}

  for (const [key, value] of Object.entries(raw)) {
    if (key === "sidebar" || key === "features" || key === "$schema") continue
    if (isBay(key)) {
      if (isObject(value)) {
        const section = withoutOld(key, value, file, `${key}.`, notes)
        sections[key] = checkShared(key, section, file, `${key}.`, notes)
      } else note({ bay: key, kind: "invalid", old: key, text: `"${key}" should be an object of settings` })
    } else if (key === "statusline") {
      note({ bay: "status", kind: "old", old: key, new: "status", text: oldText(key) })
    } else if (ROOT_SHELL.includes(key)) {
      note({ bay: "shell", kind: "old", old: key, new: `shell.${key}`, text: oldText(key) })
    } else if (key === "ui" && isObject(value)) {
      for (const inner of Object.keys(value)) {
        const now = OLD_UI[inner] ?? `shell.${inner}`
        const bay = now.startsWith("updater.") ? "updater" : "shell"
        note({ bay, kind: "old", old: `ui.${inner}`, new: now, text: oldText(`ui.${inner}`) })
      }
    } else if (ROOT_STATUS.includes(key)) {
      note({
        bay: "status",
        kind: "unread",
        old: key,
        new: `status.${key}`,
        text: `"${key}" at the top level is not read: it belongs in "status"`,
      })
    } else {
      const meant = closestName(key, TOP)
      note({
        bay: meant && isBay(meant) ? meant : "cockpit",
        kind: "unread",
        old: key,
        ...(meant ? { new: meant } : {}),
        text: `"${key}" is not a setting${meant ? `: did you mean "${meant}"?` : ""}`,
      })
    }
  }

  const sidebar = readSidebarList(raw.sidebar, file, notes)
  return {
    path: file,
    scope,
    sections,
    ...(sidebar ? { sidebar } : {}),
    features: readFeatures(raw.features, file, notes),
  } satisfies SettingsLayer
}

/**
 * Both files, read and merged. Never throws: a file that cannot be read is a notice and is ignored
 * whole — and doctor, reading through this same function, says the same.
 */
export function loadSettings(where: SettingsWhere = {}): Settings {
  const read = where.read ?? readText
  const paths = settingsPaths(where)
  const files: SettingsFile[] = []
  const layers: SettingsLayer[] = []
  const notices: SettingsNotice[] = []
  const wanted: [string, SettingsFile["scope"]][] = [[paths.global, "global"]]
  if (paths.project) wanted.push([paths.project, "project"])

  for (const [path, scope] of wanted) {
    const text = read(path)
    if (text === undefined) {
      files.push({ path, scope, found: false })
      continue
    }
    const parsed = parseJsonc(text)
    const value = parsed.ok ? parsed.value : undefined
    if (!isObject(value)) {
      const error = parsed.ok ? "not a JSON object" : parsed.message
      files.push({ path, scope, found: true, error })
      notices.push({
        bay: "cockpit",
        file: path,
        kind: "unreadable",
        text: `${error} — the whole file is ignored`,
      })
      continue
    }
    files.push({ path, scope, found: true })
    layers.push(readLayer(value, path, scope, notices))
  }

  const sections = Object.fromEntries(
    BAYS.map((bay) => [
      bay,
      layers.reduce((merged, layer) => mergeSections(merged, layer.sections[bay] ?? {}), {} as Section),
    ]),
  ) as Record<Bay, Section>
  /** A project's list replaces the global one rather than merging: it is an order, not a set. */
  const sidebarList = layers.reduce<SidebarBay[] | undefined>(
    (list, layer) => layer.sidebar ?? list,
    undefined,
  )
  const features: Partial<Record<Bay, boolean>> = Object.assign({}, ...layers.map((layer) => layer.features))
  return {
    files,
    layers,
    sections,
    ...(sidebarList ? { sidebarList } : {}),
    sidebar: [...(sidebarList ?? []), ...SIDEBAR_BAYS.filter((bay) => !sidebarList?.includes(bay))],
    features,
    notices,
  }
}

/** Notices that belong to no one bay: a file that could not be read, an unknown top-level name. */
export const cockpitNotices = (settings: Settings): SettingsNotice[] =>
  settings.notices.filter((notice) => notice.bay === "cockpit")

// ── The order ──────────────────────────────────────────────────────────────────────────────────

/**
 * The numbers the list hands out: 110, 120, … 150. OpenCode 1 sorts its own blocks by the same
 * numbers — Context 100, MCP 200, LSP 300, Todo 400, Modified files 500 — so Cockpit's blocks sit
 * together, under Context and above the rest. OpenCode 2 ignores the number and draws blocks in the
 * order they register, which `orderedSidebar` makes this same order.
 */
export const SIDEBAR_FIRST = 110
export const SIDEBAR_STEP = 10

/** Where a bay's block sits: its place in the list, and nothing else. */
export function orderOf(settings: Pick<Settings, "sidebar">, bay: SidebarBay): number {
  return SIDEBAR_FIRST + Math.max(0, settings.sidebar.indexOf(bay)) * SIDEBAR_STEP
}

// ── One bay ────────────────────────────────────────────────────────────────────────────────────

export interface BaySettings<T> {
  /** Defaults, then the global file, the project's, and plugin options. */
  config: SharedSettings & T
  /** What was written, merged, without defaults. For a bay that merges a key its own way. */
  written: Section
  /** The block's `order` for `api.slots.register`. Meaningless for a bay without a block. */
  order: number
  /** This bay's notices, from the files and from its plugin options: one `!` row each. */
  notices: SettingsNotice[]
  settings: Settings
}

export interface BayInput {
  /** The plugin entry's options: the bay's own keys, or a whole config with a section for it. */
  options?: unknown
  /** Already loaded — the bundle can load once for every bay. */
  settings?: Settings
  where?: SettingsWhere
}

type Widen<T> = {
  [K in keyof T]: T[K] extends boolean
    ? boolean
    : T[K] extends number
      ? number
      : T[K] extends string
        ? string
        : T[K]
}

/**
 * A bay's settings in one call: its defaults, every file, its plugin options, and every value whose
 * kind differs from its default's dropped (with a notice). A key whose default is undefined passes as
 * written; a key with no default at all passes too, so a bay can read what it does not type.
 *
 *   const { config, order, notices } = baySettings("shell", { dockHeight: 14, colors: true }, {
 *     options, where: { directory: api.state.path.directory },
 *   })
 */
export function baySettings<T extends object = Record<never, never>>(
  bay: Bay,
  defaults?: T,
  input: BayInput = {},
): BaySettings<Widen<T>> {
  const settings = input.settings ?? loadSettings(input.where)
  const notices = settings.notices.filter((notice) => notice.bay === bay)
  const base: Section = { ...SHARED_DEFAULTS[bay], ...(defaults as Section | undefined) }

  /** Each source checked on its own, so a notice names the file it is in. */
  const sources = settings.layers.map((layer) => ({
    file: layer.path,
    prefix: `${bay}.`,
    section: layer.sections[bay] ?? {},
  }))
  const options = optionsSection(bay, input.options)
  if (options) {
    const section = withoutOld(bay, options, OPTIONS_SOURCE, "", notices)
    sources.push({
      file: OPTIONS_SOURCE,
      prefix: "",
      section: checkShared(bay, section, OPTIONS_SOURCE, "", notices),
    })
  }

  let written: Section = {}
  for (const source of sources) {
    const checked: Section = {}
    for (const [key, value] of Object.entries(source.section)) {
      const want = kindOf(base[key])
      if (want && !(key in SHARED_KIND) && kindOf(value) !== want) {
        notices.push({
          bay,
          file: source.file,
          kind: "invalid",
          old: `${source.prefix}${key}`,
          text: `"${source.prefix}${key}" should be ${article(want)}; the default is used`,
        })
        continue
      }
      checked[key] = value
    }
    written = mergeSections(written, checked)
  }

  const config = mergeSections(base, written) as SharedSettings & Widen<T>
  config.sidebarRows = Math.max(0, Math.floor(config.sidebarRows))
  if (settings.features[bay] === false) config.enabled = false
  return {
    config,
    written,
    order: isSidebarBay(bay) ? orderOf(settings, bay) : 0,
    notices,
    settings,
  }
}

/**
 * Plugin options as one bay's section: a whole cockpit config's section for it, else the options
 * themselves (a standalone entry carries its own keys). Only for options — a *file* without a section
 * says nothing about the bay; reading the whole file as its settings was Status's trap.
 */
export function optionsSection(bay: Bay, options: unknown): Section | undefined {
  if (!isObject(options)) return undefined
  const own = options[bay]
  return isObject(own) ? own : options
}
