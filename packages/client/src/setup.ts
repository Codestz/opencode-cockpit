/**
 * Setting Cockpit up with the agent: the `cockpit_settings` tool, the `cockpit-setup` skill and the
 * `/cockpit-setup` command.
 *
 * Choosing which bays show, where and in what order is an editing job in a file the interface never
 * names, so the agent does it, with the person. What it needs splits in two, and each half lives where
 * it stays true:
 *
 * - **What does not change between installs** — the flow, the starting points, every key and its
 *   default — is the skill (`packages/client/skills/cockpit-setup`), shipped in this package and
 *   loaded when the person asks. Its reference is written from `catalog.ts`.
 * - **What does** — which bays are installed and on, what each file says, every value and where it
 *   came from, what is not read, OpenCode's own sidebar blocks — is this tool, read when it is called,
 *   through the same loader the bays read with, so it says what the interface draws.
 *
 * The command is one line naming the skill, shipped through the agent side so OpenCode itself opens a
 * conversation from home and queues it behind a reply in progress. Every Cockpit server entry offers
 * all three; the first in an OpenCode registers them (`setupServer`, called from `dualServer`). The
 * palette lists no command an agent side ships, on either version, so every TUI entry offers a palette
 * entry that sends the same line (`registerSetup`).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tool } from "@opencode-ai/plugin"
import { BAY_ABOUT, BAY_COMMANDS, bayKeys, DEFAULT_KEYS, type KeyInfo, shownDefault } from "./catalog.ts"
import {
  findSections,
  type GitRun,
  type InstructionFile,
  instructionPaths,
  type ProjectFacts,
  projectFacts,
  readInstructions,
  sectionText,
  type WriteAction,
  type Written,
  writeSection,
} from "./conventions.ts"
import { claimedFeatures, claimFeature } from "./feature.ts"
import type { Host } from "./host.ts"
import { parseJsonc } from "./jsonc.ts"
import type { ServerHost, ServerParts } from "./server.ts"
import {
  BAYS,
  type Bay,
  baySettings,
  closestName,
  isBay,
  isSidebarBay,
  loadSettings,
  OPTIONS_SOURCE,
  type Settings,
  type SettingsNotice,
  type SettingsWhere,
  type SidebarBay,
} from "./settings.ts"

/** The skill, the command that loads it, and the line the command sends. */
export const SETUP_SKILL = "cockpit-setup"
export const SETUP_SLASH = "cockpit-setup"
export const SETUP_PROMPT = "Use the cockpit-setup skill to help me set up Cockpit."
export const SETTINGS_TOOL = "cockpit_settings"

/**
 * Previews the loaded bays offer, by bay: the exact command for the copy installed here. Shared on
 * `globalThis` because the bundle and a standalone package each carry their own copy of this module.
 *
 * `bunx @opencode-cockpit/status preview` fetches the newest release from npm instead — 0.8 drew a
 * bottom line at terminal width for a 0.9 sidebar config — so the agent is handed the path.
 */
const PREVIEWS = Symbol.for("opencode-cockpit.previews")
const previewRegistry = (): Map<string, string> => {
  const shared = globalThis as { [PREVIEWS]?: Map<string, string> }
  shared[PREVIEWS] ??= new Map()
  return shared[PREVIEWS]
}

/** A bay's preview command, e.g. `bun "/…/status/dist/cli/preview.js"`. */
export function offerPreview(bay: string, command: string): void {
  previewRegistry().set(bay, command)
}

export const previewCommands = (): Record<string, string> => Object.fromEntries(previewRegistry())

/** Where the skill sits in this package: `src/` and `dist/` are both one level under its root. */
export const SETUP_SKILL_DIR = fileURLToPath(new URL(`../skills/${SETUP_SKILL}`, import.meta.url))

// ── OpenCode's own sidebar blocks ──────────────────────────────────────────────────────────────
//
// Status's table draws a Context section, so with OpenCode's own Context block on, "Context" shows
// twice. Turning that block off is OpenCode's setting, in OpenCode's file — so the tool says what it
// is set to now and how to change it, and the skill asks before touching a file that is not Cockpit's.
// Measured on 1.18.32 and 2.0.18 (docs/opencode/settings-and-commands.md, "/cockpit-setup spikes").

/** OpenCode's own sidebar blocks this talks about, and their plugin ids on each version. */
type HostBlock = "context" | "mcp" | "lsp" | "todo" | "files" | "footer"

/**
 * 1.18.32 names its blocks `internal:sidebar-*` and turns one off in `tui.json` with
 * `"plugin_enabled": { "<id>": false }`. 2.0.18 names them `opencode.sidebar.*`, turns one off with
 * `"-<id>"` in `cli.json`'s `plugins` list, and has no LSP, Todo or Files block at all. Every id is
 * the binary's own, and each switch was measured hiding its block (MCP and Footer on both versions in
 * an isolated run, 2026-10-03) — except Files, whose block never drew in a test run to hide.
 */
export const HOST_BLOCKS: Readonly<Record<1 | 2, Partial<Record<HostBlock, string>>>> = {
  1: {
    context: "internal:sidebar-context",
    mcp: "internal:sidebar-mcp",
    lsp: "internal:sidebar-lsp",
    todo: "internal:sidebar-todo",
    files: "internal:sidebar-files",
    footer: "internal:sidebar-footer",
  },
  2: { context: "opencode.sidebar.context", mcp: "opencode.sidebar.mcp", footer: "opencode.sidebar.footer" },
}

/** One of OpenCode's interface config files, and which of the blocks it switches. */
export interface HostFile {
  path: string
  found: boolean
  error?: string
  /** Block id → on or off, as this file writes it. */
  blocks: Record<string, boolean>
}

const opencodeDirs = (
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string[] => [
  join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode"),
  directory,
  join(directory, ".opencode"),
]

/** The files OpenCode reads its interface settings from: the global one, then the project's. */
export function hostFilePaths(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  const name = opencode === 1 ? "tui" : "cli"
  return opencodeDirs(directory, env, home).flatMap((dir) => [
    join(dir, `${name}.json`),
    join(dir, `${name}.jsonc`),
  ])
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** What one file says about the blocks. Never throws: a file that will not parse says so. */
export function readHostFile(opencode: 1 | 2, path: string, text: string | undefined): HostFile {
  if (text === undefined) return { path, found: false, blocks: {} }
  const parsed = parseJsonc(text)
  const value = parsed.ok ? parsed.value : undefined
  if (!isObject(value))
    return { path, found: true, error: parsed.ok ? "not a JSON object" : parsed.message, blocks: {} }
  const ids = Object.values(HOST_BLOCKS[opencode])
  const blocks: Record<string, boolean> = {}
  if (opencode === 1) {
    const enabled = value.plugin_enabled
    if (isObject(enabled))
      for (const [id, on] of Object.entries(enabled))
        if (ids.includes(id) && typeof on === "boolean") blocks[id] = on
  } else {
    for (const { name } of pluginEntries(value)) {
      const off = name.startsWith("-")
      const id = off ? name.slice(1) : name
      if (ids.includes(id)) blocks[id] = !off
    }
  }
  return { path, found: true, blocks }
}

// ── Which bays are installed ───────────────────────────────────────────────────────────────────
//
// The agent side cannot see the interface's plugins (OpenCode 2 runs them in another process, and
// OpenCode 1 in another thread), and three bays have no agent side. So "installed" is read where the
// person wrote it — OpenCode's own plugin lists — and "running here" from this side's claims.

/** The bundle's package, and the prefix every single bay's package carries. */
const BUNDLE = "opencode-cockpit"
const SCOPE = "@opencode-cockpit/"

/** One plugin entry as either version writes it: `"name"`, `["name", options]`, `{ package, options }`. */
function pluginEntries(config: Record<string, unknown>): { name: string; options?: unknown }[] {
  const lists = [config.plugin, config.plugins].filter(Array.isArray) as unknown[][]
  return lists.flat().flatMap((entry) => {
    if (typeof entry === "string") return [{ name: entry }]
    if (Array.isArray(entry) && typeof entry[0] === "string") return [{ name: entry[0], options: entry[1] }]
    if (isObject(entry) && typeof entry.package === "string")
      return [{ name: entry.package, options: entry.options }]
    return []
  })
}

/** The bays one entry brings, by its package — a name with or without a version, or a path. */
export function baysOfEntry(name: string): Bay[] {
  const path = name.replaceAll("\\", "/").replace(/\/+$/, "")
  const scoped = path.lastIndexOf(SCOPE)
  if (scoped >= 0) {
    const bay = path.slice(scoped + SCOPE.length).replace(/@.*$/, "")
    return isBay(bay) ? [bay] : []
  }
  const last = basename(path).replace(/@[^/]*$/, "")
  return last === BUNDLE ? [...BAYS] : []
}

/** A Cockpit plugin entry found in one of OpenCode's files. */
export interface Install {
  /** As written: `opencode-cockpit@0.9.0`, a path… */
  entry: string
  bundle: boolean
  file: string
  options?: unknown
}

/** OpenCode's files that list plugins: the agent side's and the interface's, global then project. */
export function opencodeConfigPaths(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  const names = ["opencode", opencode === 1 ? "tui" : "cli"]
  return opencodeDirs(directory, env, home).flatMap((dir) =>
    names.flatMap((name) => [join(dir, `${name}.json`), join(dir, `${name}.jsonc`)]),
  )
}

export function readInstalls(path: string, text: string | undefined): Install[] {
  if (text === undefined) return []
  const parsed = parseJsonc(text)
  if (!parsed.ok || !isObject(parsed.value)) return []
  return pluginEntries(parsed.value).flatMap(({ name, options }) => {
    const bays = baysOfEntry(name)
    if (bays.length === 0) return []
    return [
      { entry: name, bundle: bays.length > 1, file: path, ...(options !== undefined ? { options } : {}) },
    ]
  })
}

/** One bay's options in an entry: the bundle's section for it, else a single bay's own options. */
function entryOptions(bay: Bay, install: Install): Record<string, unknown> | undefined {
  if (!isObject(install.options)) return undefined
  if (!install.bundle) return install.options
  const own = install.options[bay]
  return isObject(own) ? own : undefined
}

// ── The report ─────────────────────────────────────────────────────────────────────────────────

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
  /** Every notice: the files', each installed bay's plugin options', and keys no bay reads. */
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

function readText(path: string): string | undefined {
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
    notices.push(...loaded.notices.filter((notice) => notice.file === OPTIONS_SOURCE))

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
    notices,
    host: hostFilePaths(input.opencode, input.directory, env, home).map((path) =>
      readHostFile(input.opencode, path, read(path)),
    ),
  }
}

// ── The tool's answer ──────────────────────────────────────────────────────────────────────────

const json = (value: unknown) => JSON.stringify(value)

function valueText(key: ResolvedKey): string {
  if (key.source === "default") return shownDefault(key.info).replaceAll("`", "")
  return json(key.value)
}

/** Where a bay's block is, in a few words. */
export function blockState(state: BayState): string {
  if (!state.on) return "—"
  const value = (key: string) => state.keys.find((each) => each.info.key === key)?.value
  if (state.bay === "status") {
    const surface = value("surface")
    return value("sidebar") === false || surface === "bottom" ? "a line under the prompt" : "in the sidebar"
  }
  if (!isSidebarBay(state.bay)) return "no sidebar block"
  if (value("sidebar") === false) return "hidden (sidebar: false)"
  return value("hideWhenEmpty") === true ? "shown, hidden while empty" : "shown, `none yet` while empty"
}

/**
 * One notice as a line to act on. An old name says what to write instead; the order's old numbers
 * have no new name to copy to, because the order is the list now.
 */
export function noticeLine(notice: SettingsNotice): string {
  const where = notice.file === OPTIONS_SOURCE ? "plugin options" : notice.file
  if (notice.kind === "old" && notice.old && notice.new) {
    if (notice.new === "sidebar")
      return `- ${where}: "${notice.old}" is no longer read. Remove it; the order is the top-level "sidebar" list.`
    return `- ${where}: "${notice.old}" is no longer read. Move its value to "${notice.new}" and remove "${notice.old}".`
  }
  return `- ${where}: ${notice.text.replace(/ — run \/cockpit-setup$/, "")}.`
}

/** Whether Status draws its table in the sidebar. */
function statusInSidebar(report: SettingsReport): boolean {
  const status = report.bays.find((state) => state.bay === "status")
  return status?.on === true && blockState(status) === "in the sidebar"
}

/** OpenCode's own blocks: what each is set to now, where, and what to suggest. */
function hostSection(report: SettingsReport): string[] {
  const ids = HOST_BLOCKS[report.opencode]
  const found = report.host.filter((file) => file.found)
  /** Global, then project: the last file that sets a block is the one in force. */
  const state = (id: string) => {
    const file = [...found].reverse().find((each) => id in each.blocks)
    return { on: file ? file.blocks[id] !== false : true, file: file?.path }
  }
  const said = (id: string) => {
    const { on, file } = state(id)
    return `${on ? "on" : "off"} (${file ? `set in ${file}` : "default"})`
  }
  const global = report.host.find((file) => file.found && !file.error)?.path ?? report.host[0]?.path ?? ""
  const exists = report.host.some((file) => file.path === global && file.found)
  const target = `${global}${exists ? "" : " (create it)"}`
  const how =
    report.opencode === 1
      ? (id: string, on: boolean) => `\`"plugin_enabled": { "${id}": ${on} }\` in ${target}`
      : (id: string, on: boolean) =>
          on
            ? `remove \`"-${id}"\` from the \`"plugins"\` list in the cli.json that has it`
            : `add \`"-${id}"\` to the \`"plugins"\` list in ${target}, keeping every entry already there`
  const lines = [
    `## OpenCode's own sidebar blocks (OpenCode ${report.opencode}: ${report.opencode === 1 ? '`tui.json` → `"plugin_enabled"`' : '`cli.json` → `"plugins"`'})`,
    "",
  ]
  if (ids.context) {
    lines.push(`- Context \`${ids.context}\`: ${said(ids.context)}.`)
    if (state(ids.context).on && statusInSidebar(report))
      lines.push(
        `  Status draws its table in the sidebar, so "Context" shows twice. Suggest turning OpenCode's off: ${how(ids.context, false)}.`,
      )
  }
  /** A block that is the person's call: its state, why one might hide it, and the switch either way. */
  const optional = (name: string, id: string | undefined, why: string) => {
    if (!id) return
    const { on } = state(id)
    lines.push(
      `- ${name} \`${id}\`: ${said(id)}. Optional; offer it without recommending either way. ${why} ${on ? `Off: ${how(id, false)}` : `Back on: ${how(id, true)}`}.`,
    )
  }
  optional(
    "MCP",
    ids.mcp,
    `Lists every MCP server and its state. ${statusInSidebar(report) ? "Status's table already warns when one fails, so hiding" : "Hiding"} the list makes the sidebar quieter; \`opencode mcp list\` still shows every server.`,
  )
  optional("LSP", ids.lsp, "Lists the language servers running.")
  optional("Files", ids.files, "Lists the files this conversation changed.")
  optional("Footer", ids.footer, "The project's path and git branch at the bottom of the sidebar.")
  if (ids.todo)
    lines.push(
      state(ids.todo).on
        ? `- Todo \`${ids.todo}\`: on. Never suggest turning it off: nothing in Cockpit replaces it.`
        : `- Todo \`${ids.todo}\`: ${said(ids.todo)}. Say it is off and offer to turn it back on (nothing in Cockpit replaces it): ${how(ids.todo, true)}.`,
    )
  if (report.opencode === 2) lines.push("- OpenCode 2 has no LSP, Todo or Files block in the sidebar.")
  const broken = found.filter((file) => file.error)
  for (const file of broken)
    lines.push(`- ${file.path} does not parse (${file.error}): fix it before editing.`)
  lines.push(
    "- These are OpenCode's files, not Cockpit's: ask before changing one, and keep everything else in it.",
  )
  return [...lines, ""]
}

/** What `cockpit_settings` answers. Leads with what to fix, then the state, then what to do next. */
export function settingsText(report: SettingsReport, previews: Record<string, string> = {}): string {
  const { settings } = report
  const installed = report.bays.filter((state) => state.installs.length > 0 || state.running)
  const order = settings.sidebar.filter((bay) =>
    installed.some((state) => state.bay === bay && state.on),
  ) as SidebarBay[]
  const written = Object.fromEntries([
    ...(settings.sidebarList ? [["sidebar", settings.sidebarList] as const] : []),
    ...(Object.keys(settings.features).length > 0 ? [["features", settings.features] as const] : []),
    ...Object.entries(settings.sections).filter(([, section]) => Object.keys(section).length > 0),
  ])
  const fileLine = (file: Settings["files"][number]) =>
    `- ${file.scope}: ${file.path} — ${
      file.error
        ? `does not parse (${file.error}); the whole file is ignored until it does`
        : file.found
          ? "exists"
          : file.scope === "global"
            ? "not created yet (create it, folder included)"
            : "not created yet (for settings only this project uses)"
    }`

  const bayLines = report.bays.flatMap((state) => {
    if (state.installs.length === 0 && !state.running) return []
    const via = [...new Set(state.installs.map((install) => install.entry))].join(", ") || "this agent side"
    const head = `### ${state.bay} — ${state.on ? "on" : `off (${state.off})`} · block: ${blockState(state)} · from ${via}`
    if (!state.on && state.off === "not installed") return [head, ""]
    const set = state.keys.filter((key) => key.source !== "default")
    const rest = state.keys.filter((key) => key.source === "default")
    return [
      head,
      `- is: ${BAY_ABOUT[state.bay]}`,
      ...(set.length > 0
        ? [`- set: ${set.map((key) => `${key.info.key} ${valueText(key)} (${key.source})`).join(" · ")}`]
        : []),
      `- defaults: ${rest.map((key) => `${key.info.key} ${valueText(key)}`).join(" · ")}`,
      "",
    ]
  })
  const missing = report.bays.filter((state) => state.installs.length === 0 && !state.running)

  return [
    `# Cockpit settings — OpenCode ${report.opencode}, project ${report.directory}`,
    "",
    report.notices.length === 0
      ? "Notices: none. Every setting written is read."
      : [
          `## Fix these first (${report.notices.length})`,
          "",
          "Each is ignored, so the value under it does nothing. Fix them in the same file before anything else, and say what changed:",
          "",
          ...report.notices.map(noticeLine),
        ].join("\n"),
    "",
    "## Files (JSONC; the project's wins over the global key by key; read when OpenCode starts)",
    "",
    ...settings.files.map(fileLine),
    "",
    Object.keys(written).length === 0
      ? "Written: nothing. Every bay is on its defaults."
      : `Written, both files merged: ${json(written)}`,
    "",
    `## Bays (sidebar order, top to bottom: ${order.join(", ") || "no blocks"}${settings.sidebarList ? ", from the `sidebar` list" : ", the default"})`,
    "",
    ...bayLines,
    ...(missing.length > 0
      ? [
          `Not installed: ${missing.map((state) => state.bay).join(", ")}. Their settings do nothing; do not ask about them.`,
          "",
        ]
      : []),
    ...hostSection(report),
    ...(Object.keys(previews).length > 0
      ? [
          "## Previews (this install's own — use exactly these; `bunx`/`npx` fetch another release)",
          "",
          ...Object.entries(previews).map(([bay, command]) => `- ${bay}: \`${command}\``),
          "",
        ]
      : []),
    "## Next",
    "",
    ...(report.notices.length > 0
      ? [`- Fix the ${report.notices.length} notice${report.notices.length === 1 ? "" : "s"} above first.`]
      : []),
    "- Write only keys that differ from the defaults. Global file unless the person wants this project only.",
    "- After writing, call cockpit_settings again: it should say `Notices: none`.",
    "- Changes apply after OpenCode restarts.",
  ].join("\n")
}

// ── The second phase: making it fit how the person works ───────────────────────────────────────
//
// Asked for with `cockpit_settings({ tune: true })`, after the blocks are set: a tour of what each
// installed bay does for the person, with the keys as they are set now; what the project runs that
// never ends; the ticket keys its history uses; and what each AGENTS.md says now. The conventions
// themselves are written by `cockpit_conventions` (conventions.ts).

export const CONVENTIONS_TOOL = "cockpit_conventions"

export interface TuneFacts {
  project: ProjectFacts
  instructions: InstructionFile[]
}

export function tuneFacts(input: ReportInput, git?: GitRun): TuneFacts {
  const env = input.env ?? process.env
  const home = input.home ?? homedir()
  const read = input.read ?? readText
  return {
    project: projectFacts(input.directory, read, git),
    instructions: readInstructions(input.opencode, input.directory, env, home, read),
  }
}

/** A bay's commands with the keys they have now: its defaults, then what `keybinds` wrote over them. */
export function bayCommands(state: BayState): { key?: string; slash?: string; does: string }[] {
  const written = state.keys.find((key) => key.info.key === "keybinds")?.value
  const keys: Record<string, unknown> = { ...DEFAULT_KEYS[state.bay], ...(isObject(written) ? written : {}) }
  return BAY_COMMANDS[state.bay].map((command) => {
    const key = command.command ? keys[command.command] : undefined
    return {
      ...(typeof key === "string" && key !== "none" ? { key } : {}),
      ...(command.slash ? { slash: command.slash } : {}),
      does: command.does,
    }
  })
}

function tourLines(report: SettingsReport): string[] {
  return report.bays
    .filter((state) => state.on)
    .map((state) => {
      const commands = bayCommands(state)
        .map((each) =>
          [each.key ? `\`${each.key}\`` : "", each.slash ? `\`/${each.slash}\`` : "", each.does]
            .filter(Boolean)
            .join(" "),
        )
        .join(" · ")
      return `- ${state.bay} — ${BAY_ABOUT[state.bay]}${commands ? `. ${commands}` : ""}`
    })
}

function instructionLines(file: InstructionFile): string[] {
  const head = `- ${file.scope}: ${file.path} — `
  if (file.unclosed)
    return [
      `${head}its Cockpit section (line ${file.unclosed}) has no end marker; ${CONVENTIONS_TOOL} says how to fix it`,
    ]
  if (!file.exists)
    return [
      `${head}not created yet (${CONVENTIONS_TOOL} creates it)`,
      ...(file.shadows
        ? [
            `  ${file.shadows} exists, and OpenCode 1 reads it only while there is no ${file.path}: creating this file stops OpenCode 1 reading that one. Say so before choosing it.`,
          ]
        : []),
    ]
  if (file.sections === 0) return [`${head}exists, no Cockpit section yet (one would be added at the end)`]
  return [
    `${head}has the Cockpit section${file.sections > 1 ? ` ${file.sections} times (a write merges them into one)` : ""}. Now:`,
    "",
    ...(file.body ? file.body.split("\n").map((line) => `    ${line}`) : ["    (empty)"]),
    "",
  ]
}

/** The second phase's facts, after the settings. */
export function tuneText(report: SettingsReport, facts: TuneFacts): string {
  const { project } = facts
  const long = project.longRunning.map((each) => `- \`${each.command}\` — ${each.from}`)
  const tickets = project.tickets.map((each) => `${each.prefix} (${each.count}, e.g. ${each.example})`)
  return [
    "## Tune it to how they work",
    "",
    "Conventions only: every request already tells the agent how to use each bay, so never write how to use Cockpit.",
    "",
    "### The tour: what each bay does for them (keys as set now; `<leader>` is OpenCode's leader key, ctrl+x unless they changed it)",
    "",
    ...tourLines(report),
    "",
    `### This project (${report.directory})`,
    "",
    ...(long.length > 0
      ? ["Long-running commands found — offer these as background shells:", ...long]
      : ["No long-running command found in package.json, a Makefile, a compose file or a Procfile: ask."]),
    ...(project.otherScripts.length > 0
      ? [
          `Other package.json scripts (they end on their own): ${project.otherScripts.slice(0, 20).join(", ")}`,
        ]
      : []),
    ...(project.packageManager ? [`Package manager: ${project.packageManager}`] : []),
    `Ticket keys in branch names and the last 200 commits: ${tickets.length > 0 ? tickets.join(", ") : "none seen — ask"}`,
    `Git remotes: ${project.remotes.length > 0 ? project.remotes.map((each) => `${each.repo} (${each.name})`).join(", ") : "none"}`,
    "",
    `### AGENTS.md — where the conventions go, as one marked section written with ${CONVENTIONS_TOOL}`,
    "",
    ...facts.instructions.flatMap(instructionLines),
    "- The project file is for this repository's conventions (the team's too, if committed); the global one for every project.",
    `- Ask before writing. ${CONVENTIONS_TOOL} replaces the section in place and keeps the rest of the file byte for byte.`,
  ].join("\n")
}

/** What `cockpit_conventions` answers: what it did, where, and the section as it now reads. */
export function conventionsReply(path: string, written: Extract<Written, { ok: true }>): string {
  const did: Record<WriteAction, string> = {
    created: `Created ${path} with the Cockpit section.`,
    added: `Added the Cockpit section at the end of ${path}; everything before it is unchanged.`,
    updated: `Updated the Cockpit section in ${path}; everything outside it is unchanged.`,
    unchanged: `${path} already had exactly this section: nothing written.`,
    removed:
      written.text === undefined
        ? `Removed the Cockpit section; ${path} held nothing else, so it was deleted.`
        : `Removed the Cockpit section from ${path}; everything else is unchanged.`,
    absent: `${path} has no Cockpit section: nothing to remove.`,
  }
  const found = written.text ? findSections(written.text) : undefined
  const body = found?.ok ? found.sections[0]?.body : undefined
  return [
    did[written.action],
    ...(written.merged > 0 ? [`It had ${written.merged + 1} Cockpit sections; they are one now.`] : []),
    ...(body ? ["", "The section now:", "", sectionText(body)] : []),
    "",
    "OpenCode reads AGENTS.md when a conversation starts: it applies to new conversations.",
  ].join("\n")
}

// ── The agent side: tool, skill and command ────────────────────────────────────────────────────

const TOOL_DESCRIPTION = [
  "Cockpit's settings as they are now, read fresh: which bays are installed and on, where each draws,",
  "every value with where it came from (default, global file, project file, plugin options), the sidebar",
  "order, every setting that is not read and how to fix it, the settings files' paths, and OpenCode's own",
  "sidebar blocks with the exact syntax to switch them. Read-only. Call it before changing Cockpit's",
  "settings and again after writing, to check the change: it should then report no notices.",
  "With tune: true it adds the second phase of /cockpit-setup: a tour of each bay's keys and commands,",
  "the project's long-running commands, ticket keys and remotes, and what each AGENTS.md's Cockpit section says.",
].join(" ")

const CONVENTIONS_DESCRIPTION = [
  "Writes the person's Cockpit conventions into an AGENTS.md as one marked `## Cockpit conventions` section:",
  "replaced in place when it is there, added at the end when not, the rest of the file kept byte for byte.",
  "Only after the person agreed to the text and the file. `conventions` is the section's markdown without",
  "its heading; an empty string removes the section. Returns the section as it now reads.",
].join(" ")

/**
 * The tool, the skill and the command, once per OpenCode: the first Cockpit server entry to ask gets
 * them, the rest get nothing, so a bundle beside a single bay registers one of each.
 */
export function setupServer(host: ServerHost, source: string): ServerParts {
  const claim = claimFeature(host.scope, "setup", source)
  if (!claim.active) return {}
  const z = tool.schema
  const settings = tool({
    description: TOOL_DESCRIPTION,
    args: {
      tune: z
        .boolean()
        .optional()
        .describe("true for the second phase: the tour, the project's facts and the AGENTS.md sections"),
    },
    execute: async (args) => {
      const input: ReportInput = {
        opencode: host.version,
        directory: host.directory,
        claims: claimedFeatures(host.scope),
      }
      const report = settingsReport(input)
      host.log.info("setup: settings read", { notices: report.notices.length, tune: args.tune === true })
      const text = settingsText(report, previewCommands())
      return args.tune ? `${text}\n\n${tuneText(report, tuneFacts(input))}` : text
    },
  })
  const conventions = tool({
    description: CONVENTIONS_DESCRIPTION,
    args: {
      file: z
        .enum(["project", "global"])
        .describe("project: this repository's AGENTS.md; global: OpenCode's, read in every project"),
      conventions: z.string().describe("The section's markdown, without its heading. Empty removes it."),
    },
    execute: async (args, ctx) => {
      const path = instructionPaths(host.directory, process.env, homedir())[args.file]
      const written = writeSection(readText(path), args.conventions)
      if (!written.ok) throw new Error(written.error)
      if (written.action !== "unchanged" && written.action !== "absent") {
        /** The file is the person's: OpenCode's own edit permission decides, as for any edit. */
        await ctx.ask({ permission: "edit", patterns: [path], always: [path], metadata: { filepath: path } })
        if (written.text === undefined) rmSync(path, { force: true })
        else {
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, written.text)
        }
      }
      host.log.info("setup: conventions written", { file: args.file, action: written.action })
      return conventionsReply(path, written)
    },
  })
  return {
    tools: { [SETTINGS_TOOL]: settings, [CONVENTIONS_TOOL]: conventions },
    skills: [{ dir: SETUP_SKILL_DIR }],
    commands: [
      {
        name: SETUP_SLASH,
        description: "set up Cockpit with the agent: which bays show, where, in what order",
        prompt: SETUP_PROMPT,
      },
    ],
    dispose: () => claim.release(),
  }
}

// ── The interface: a palette entry ─────────────────────────────────────────────────────────────

/** The session on screen, if there is one. */
function sessionOnScreen(host: Host): string | undefined {
  const route = host.route.current
  return route.name === "session"
    ? (route.params as { sessionID?: string } | undefined)?.sessionID
    : undefined
}

/**
 * Hands `text` to the agent from wherever the person is, with a toast saying it did — the effect can
 * land somewhere the screen is not showing yet. Measured on 1.18.32 and 2.0.18:
 *
 * - in a conversation, idle: sent, and the turn starts;
 * - the agent busy: queued behind the running turn, shown as queued in the conversation;
 * - home, no conversation: v1's prompt starts one when submitted; v2 gets one made and opened here.
 *
 * On the next tick, because running a slash command clears the prompt it was typed into: anything
 * written during the command itself is wiped a moment later.
 */
export function briefAgent(host: Host, text: string, title: string, done = "Asked the agent."): void {
  setTimeout(() => {
    const failed = (error?: unknown) => {
      host.log.warn("setup: could not reach the agent", { error })
      host.ui.toast({ variant: "error", title, message: "Could not reach the agent." })
    }
    const sent = () => host.ui.toast({ variant: "info", title, message: done })
    if (host.v1) {
      const tui = host.v1.client.tui
      void tui
        .appendPrompt({ text })
        .then(() => tui.submitPrompt())
        .then(sent)
        .catch(failed)
      return
    }
    void toConversation(host, text).then(
      (where) => (where ? sent() : host.ui.toast({ title, message: "Open a conversation first." })),
      failed,
    )
  }, 0)
}

/** OpenCode 2: the conversation on screen, or a new one opened for it from home. */
async function toConversation(host: Host, text: string): Promise<string | undefined> {
  const session = host.v2?.data.session
  let id = sessionOnScreen(host)
  if (!id) {
    const created = session?.create?.({})
    if (!created) return undefined
    await created.request
    host.v2?.ui.router.navigate?.({ type: "session", sessionID: created.id })
    id = created.id
  }
  /**
   * Busy, it waits its turn. v2's default hands a message to the turn that is running ("steer"),
   * which cut a reply off mid-sentence to start on this; queued, the reply finishes and the line
   * shows as `1 queued` under the conversation — what v1 does with a prompt submitted while busy.
   */
  const busy = session?.status?.(id) === "running"
  await session?.prompt?.({ sessionID: id, text, ...(busy ? { delivery: "queue" as const } : {}) })
  return id
}

/**
 * The palette entry, once per window. Neither OpenCode lists a command an agent side ships in its
 * palette (measured: `ctrl+p` → "cockpit" finds nothing), so the interface offers one that sends the
 * command's own line. No slash name: `/cockpit-setup` is the shipped command's, and a second
 * `/cockpit-setup` in the popup would be two rows doing one thing.
 */
export function registerSetup(host: Host, source: string): void {
  const claim = claimFeature(host.renderer, "setup", source)
  if (!claim.active) return
  host.lifecycle.onDispose(() => claim.release())
  host.keymap.registerLayer({
    commands: [
      {
        name: "cockpit.setup",
        title: "Ask the agent to set up Cockpit",
        desc: "which bays show, where, in what order",
        category: "Cockpit",
        namespace: "palette",
        run: () => {
          host.log.info("setup: asked from the palette")
          briefAgent(host, SETUP_PROMPT, "Cockpit setup")
        },
      },
    ],
  } as never)
}
