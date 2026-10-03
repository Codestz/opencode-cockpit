/**
 * `/cockpit-setup`: the brief that sets Cockpit up, handed to the agent.
 *
 * Like `/status-setup` it draws nothing. Choosing which bays show, where and in what order is an
 * editing job in a file the interface never names, so the useful thing is a message to the agent
 * already in the session carrying what it cannot look up: which bays this window loaded, which files
 * Cockpit reads and what is in them, every name it no longer reads, and every key with its default —
 * then the questions to put to the person before anything is written.
 *
 * One command for every bay. Whichever Cockpit entry starts first in a window registers it
 * (`registerSetup`, called from `dualTui`, so the bundle and any standalone bay alike carry it), and
 * the bays it lists are the ones that claimed themselves in that window (`claimedFeatures`), read when
 * it runs — the bundle, two standalone packages, or one.
 *
 * The brief is built from the loader's own names and defaults, and from the defaults each bay hands
 * `baySettings`, never a copy of them, so it cannot describe a setting that is not read
 * (docs/opencode/settings-and-commands.md, Part B).
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { claimedFeatures, claimFeature } from "./feature.ts"
import type { Host } from "./host.ts"
import { parseJsonc } from "./jsonc.ts"
import {
  BAYS,
  type Bay,
  type BayRead,
  baysRead,
  isSidebarBay,
  loadSettings,
  OLD_NAMES,
  SETUP_COMMAND,
  type Settings,
  type SettingsNotice,
  SHARED_DEFAULTS,
  type SharedSettings,
  SIDEBAR_BAYS,
} from "./settings.ts"

/** The slash name, without its `/`. */
export const SETUP_SLASH = SETUP_COMMAND.slice(1)

/** What each shared key does. Typed by the interface, so a key added there and not here fails to build. */
const SHARED_ABOUT: Readonly<Record<keyof SharedSettings, string>> = {
  enabled: "the bay's off switch, both halves; `false` turns it off (so does `features.<bay>: false`)",
  keybinds: 'keys for its commands, `{ "<command>": "<key>" }`; leave alone unless asked',
  sidebar:
    "draw its sidebar block, true or false. For Status, false puts its line at the bottom, under the prompt",
  sidebarRows: "rows its block lists before the rest fold into `+ N more`",
  hideWhenEmpty:
    "true: no block at all while there is nothing to list. false: the heading and `none yet`, so it is plain the bay is installed",
}

/** Keys that only mean something for a bay with a sidebar block. */
const BLOCK_KEYS: readonly (keyof SharedSettings)[] = ["sidebar", "sidebarRows", "hideWhenEmpty"]

/** What a bay is, in the words the brief uses to ask about it. */
const BAY_ABOUT: Readonly<Record<Bay, string>> = {
  status: "the statusline: context, tokens, cost, git; in the sidebar by default, or under the prompt",
  subagents: "the subagents a conversation launched, live",
  shell: "background shells the agent started, with a dock and a console",
  trail: "what a conversation created or changed: PRs, branches, links",
  trust: "what Trust answered for you instead of asking; its block is off by default",
  review: "the pane for reviewing changes; no sidebar block",
  updater: "checks for plugin updates; no sidebar block",
}

// ── OpenCode's own sidebar blocks ──────────────────────────────────────────────────────────────
//
// Status's table draws a Context section, so with OpenCode's own Context block on, "Context" shows
// twice. Turning that block off is OpenCode's setting, in OpenCode's file — so the brief says what it
// is set to now and how to change it, and the agent asks before touching a file that is not Cockpit's.
// Measured on 1.18.32 and 2.0.18 (docs/opencode/settings-and-commands.md, "/cockpit-setup spikes").

/** OpenCode's own sidebar blocks the brief talks about, and their plugin ids on each version. */
type HostBlock = "context" | "lsp" | "todo"

/**
 * 1.18.32 names its blocks `internal:sidebar-*` and turns one off in `tui.json` with
 * `"plugin_enabled": { "<id>": false }`. 2.0.18 names them `opencode.sidebar.*`, turns one off with
 * `"-<id>"` in `cli.json`'s `plugins` list, and has no LSP or Todo block at all.
 */
export const HOST_BLOCKS: Readonly<Record<1 | 2, Partial<Record<HostBlock, string>>>> = {
  1: { context: "internal:sidebar-context", lsp: "internal:sidebar-lsp", todo: "internal:sidebar-todo" },
  2: { context: "opencode.sidebar.context" },
}

/** One of OpenCode's interface config files, and which of the blocks it switches. */
export interface HostFile {
  path: string
  found: boolean
  error?: string
  /** Block id → on or off, as this file writes it. */
  blocks: Record<string, boolean>
}

/** The files OpenCode reads its interface settings from: the global one, then the project's. */
export function hostFilePaths(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  const name = opencode === 1 ? "tui" : "cli"
  const global = join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode")
  return [global, directory, join(directory, ".opencode")].flatMap((dir) => [
    join(dir, `${name}.json`),
    join(dir, `${name}.jsonc`),
  ])
}

/** What one file says about the blocks. Never throws: a file that will not parse says so. */
export function readHostFile(opencode: 1 | 2, path: string, text: string | undefined): HostFile {
  if (text === undefined) return { path, found: false, blocks: {} }
  const parsed = parseJsonc(text)
  const value = parsed.ok ? parsed.value : undefined
  if (typeof value !== "object" || value === null)
    return { path, found: true, error: parsed.ok ? "not a JSON object" : parsed.message, blocks: {} }
  const ids = Object.values(HOST_BLOCKS[opencode])
  const blocks: Record<string, boolean> = {}
  if (opencode === 1) {
    const enabled = (value as { plugin_enabled?: unknown }).plugin_enabled
    if (typeof enabled === "object" && enabled !== null)
      for (const [id, on] of Object.entries(enabled))
        if (ids.includes(id) && typeof on === "boolean") blocks[id] = on
  } else {
    const plugins = (value as { plugins?: unknown }).plugins
    for (const entry of Array.isArray(plugins) ? plugins : []) {
      const name = typeof entry === "string" ? entry : (entry as { package?: unknown })?.package
      if (typeof name !== "string") continue
      const off = name.startsWith("-")
      const id = off ? name.slice(1) : name
      if (ids.includes(id)) blocks[id] = !off
    }
  }
  return { path, found: true, blocks }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

export interface SetupReport {
  /** Which OpenCode this window is. */
  opencode: 1 | 2
  directory: string
  /** The bays this window loaded, in the default order, and the copy that loaded each. */
  loaded: { bay: Bay; source: string }[]
  settings: Settings
  /** Every key each bay reads and its default: the bay's own object where it has read its settings. */
  defaults: Record<Bay, Record<string, unknown>>
  /** Every notice: the files' (from `loadSettings`), then each loaded bay's plugin options'. */
  notices: SettingsNotice[]
  /** OpenCode's own interface config files, global first: what they say about its sidebar blocks. */
  host: HostFile[]
}

export interface ReportInput {
  opencode: 1 | 2
  directory: string
  /** Feature claims in this window: `{ shell: "opencode-cockpit", setup: … }`. Non-bays are ignored. */
  claims: ReadonlyMap<string, string>
  /** As `baysRead()` returns them. */
  bays?: ReadonlyMap<Bay, BayRead>
  settings?: Settings
  env?: Readonly<Record<string, string | undefined>>
  home?: string
  /** A file's text, or undefined when there is none — for both Cockpit's files and OpenCode's. */
  read?: (path: string) => string | undefined
}

export function buildSetupReport(input: ReportInput): SetupReport {
  const settings =
    input.settings ??
    loadSettings({
      directory: input.directory,
      ...(input.env ? { env: input.env } : {}),
      ...(input.home ? { home: input.home } : {}),
      ...(input.read ? { read: input.read } : {}),
    })
  const loaded = BAYS.filter((bay) => input.claims.has(bay)).map((bay) => ({
    bay,
    source: input.claims.get(bay) as string,
  }))
  const defaults = {} as SetupReport["defaults"]
  for (const bay of BAYS) defaults[bay] = { ...SHARED_DEFAULTS[bay], ...input.bays?.get(bay)?.defaults }
  const fromOptions = loaded.flatMap(({ bay }) => input.bays?.get(bay)?.notices ?? [])
  return {
    opencode: input.opencode,
    directory: input.directory,
    loaded,
    settings,
    defaults,
    notices: [...settings.notices, ...fromOptions],
    host: hostFilePaths(input.opencode, input.directory, input.env, input.home).map((path) =>
      readHostFile(input.opencode, path, (input.read ?? readText)(path)),
    ),
  }
}

// ── The brief ──────────────────────────────────────────────────────────────────────────────────

const SHARED_KEYS = Object.keys(SHARED_ABOUT) as (keyof SharedSettings)[]

const json = (value: unknown) => JSON.stringify(value)

/** A default as the brief writes it; an empty one is "unset", which is what it means to the bay. */
function shownDefault(value: unknown): string {
  if (value === undefined || value === "") return "unset"
  if (Array.isArray(value) && value.length === 0) return "unset"
  if (typeof value === "object" && value !== null && Object.keys(value).length === 0) return "unset"
  return json(value)
}

function fileLine(file: Settings["files"][number]): string {
  const state = file.error
    ? `unreadable: ${file.error}; the whole file is ignored until it parses`
    : file.found
      ? "exists"
      : "does not exist yet"
  return `  - ${file.scope}: \`${file.path}\` (${state})`
}

/**
 * One notice as a line to act on. An old name says what to write instead in its own words — its
 * sentence ends "run /cockpit-setup", which is the command that sent this.
 */
function noticeLine(notice: SettingsNotice): string {
  const where = `\`${notice.file}\``
  if (notice.kind !== "old" || !notice.old || !notice.new) return `- ${where}: ${notice.text}.`
  /** A number for one bay's place has no new name: the order is the list now. */
  if (notice.new === "sidebar")
    return `- ${where}: \`${notice.old}\` is no longer read. Remove it; the order is the top-level \`sidebar\` list.`
  return `- ${where}: \`${notice.old}\` is no longer read. Write it as \`${notice.new}\`.`
}

/** The settings as written, both files merged: only what someone wrote. */
function written(settings: Settings): Record<string, unknown> {
  const sections = Object.fromEntries(
    Object.entries(settings.sections).filter(([, section]) => Object.keys(section).length > 0),
  )
  return {
    ...(settings.sidebarList ? { sidebar: settings.sidebarList } : {}),
    ...(Object.keys(settings.features).length > 0 ? { features: settings.features } : {}),
    ...sections,
  }
}

/** Whether Status draws its table in the sidebar, as written (the default is the sidebar). */
function statusInSidebar(settings: Settings): boolean {
  const status = settings.sections.status
  return status.sidebar !== false && status.surface !== "bottom"
}

/** OpenCode's own blocks: what each is set to now, where, and what to suggest. */
function hostSection(report: SetupReport, loaded: ReadonlySet<Bay>): string[] {
  const ids = HOST_BLOCKS[report.opencode]
  const found = report.host.filter((file) => file.found)
  /** Global, then project: the last file that sets a block is the one in force. */
  const state = (id: string) => {
    const file = [...found].reverse().find((each) => id in each.blocks)
    return { on: file ? file.blocks[id] !== false : true, file: file?.path }
  }
  const said = (id: string) => {
    const { on, file } = state(id)
    return `${on ? "on" : "off"}${file ? ` (set in \`${file}\`)` : " (the default)"}`
  }
  const global = report.host[0]?.path ?? ""
  const how =
    report.opencode === 1
      ? (id: string, on: boolean) =>
          `\`"plugin_enabled": { "${id}": ${on} }\` in \`tui.json\` (global: \`${global}\`)`
      : (id: string, on: boolean) =>
          on
            ? `remove \`"-${id}"\` from the \`"plugins"\` list in the \`cli.json\` that has it`
            : `add \`"-${id}"\` to the \`"plugins"\` list in \`cli.json\` (global: \`${global}\`)`
  const lines = [
    "## OpenCode's own sidebar blocks",
    "",
    "These are OpenCode's settings, in OpenCode's files, not Cockpit's: change one only after I say yes",
    "to that change, keep everything else in the file as it is, and they too apply after a restart.",
    "",
    `- Files read: ${
      found.length === 0
        ? "none exist yet"
        : found
            .map((file) => `\`${file.path}\`${file.error ? ` (unreadable: ${file.error})` : ""}`)
            .join(", ")
    }.`,
  ]
  if (ids.context) {
    const on = state(ids.context).on
    lines.push(`- Context (\`${ids.context}\`): ${said(ids.context)}.`)
    if (on && loaded.has("status") && statusInSidebar(report.settings))
      lines.push(
        `  Suggest turning it off: Status's table in the sidebar replaces it, and with both on "Context" shows twice. To turn it off: ${how(ids.context, false)}.`,
      )
  }
  if (ids.lsp)
    lines.push(
      `- LSP (\`${ids.lsp}\`): ${said(ids.lsp)}. You may offer to turn it off, as an option, without recommending it either way: ${how(ids.lsp, false)}.`,
    )
  if (ids.todo) {
    const on = state(ids.todo).on
    lines.push(
      on
        ? `- Todo (\`${ids.todo}\`): on. Never suggest turning it off: Cockpit has nothing that replaces the todo list.`
        : `- Todo (\`${ids.todo}\`): ${said(ids.todo)}. Tell me it is off and offer to turn it back on (Cockpit has nothing that replaces it): ${how(ids.todo, true)}.`,
    )
  }
  if (report.opencode === 2) lines.push("- OpenCode 2 draws no LSP or Todo block in the sidebar.")
  return [...lines, ""]
}

/** The decisions to put to the person, in the order they build on each other. */
function questions(loaded: ReadonlySet<Bay>): string[] {
  const blocks = [...loaded].filter(isSidebarBay)
  return [
    "Which of the loaded bays I want at all (`enabled: false` in a bay's section turns it off).",
    ...(loaded.has("status")
      ? [
          "Status in the sidebar or at the bottom under the prompt (`status.sidebar`). What its line shows is `/status-setup`'s job, afterwards: do not design it here.",
        ]
      : []),
    ...(blocks.length > 1
      ? ["The order of the sidebar blocks, top to bottom (the top-level `sidebar` list)."]
      : []),
    ...(blocks.length > 0
      ? [
          "For each block: shown with `none yet` while empty, or hidden until it has something (`hideWhenEmpty`); and how many rows before it folds (`sidebarRows`).",
        ]
      : []),
    ...(loaded.has("trust") ? ["Whether Trust gets a sidebar block (`trust.sidebar`, off by default)."] : []),
    "Which file: the global one (every project) or this project's.",
    "OpenCode's own blocks, as the section above says: only what it says to suggest or offer, and only with my yes.",
  ]
}

export function setupBrief(report: SetupReport): string {
  const { settings } = report
  const loaded = new Set(report.loaded.map((each) => each.bay))
  const missing = BAYS.filter((bay) => !loaded.has(bay))
  const sources = [...new Set(report.loaded.map((each) => each.source))]
  const now = written(settings)
  const old = report.notices.filter((notice) => notice.kind === "old")
  const rest = report.notices.filter((notice) => notice.kind !== "old")

  const blockKeys = SHARED_KEYS.filter((key) => BLOCK_KEYS.includes(key))
  const table = [
    `| bay | ${blockKeys.join(" | ")} |`,
    `| --- |${blockKeys.map(() => " --- |").join("")}`,
    ...SIDEBAR_BAYS.map(
      (bay) => `| ${bay} | ${blockKeys.map((key) => shownDefault(report.defaults[bay][key])).join(" | ")} |`,
    ),
  ]
  const ownKeys = report.loaded.flatMap(({ bay }) => {
    const own = Object.entries(report.defaults[bay]).filter(([key]) => !(key in SHARED_ABOUT))
    if (own.length === 0) return []
    return [`- \`${bay}\`: ${own.map(([key, value]) => `\`${key}\` ${shownDefault(value)}`).join(", ")}`]
  })

  return [
    "Help me set up opencode-cockpit: which of its bays show, where, and in what order.",
    "",
    "## Where it stands",
    "",
    `- OpenCode ${report.opencode}, project \`${report.directory}\`.`,
    `- Loaded in this window${sources.length > 0 ? ` (from ${sources.join(", ")})` : ""}:`,
    ...(report.loaded.length === 0
      ? ["  - none"]
      : report.loaded.map(({ bay }) => `  - \`${bay}\`: ${BAY_ABOUT[bay]}`)),
    ...(missing.length > 0
      ? [`- Not installed: ${missing.join(", ")}. Their settings do nothing; do not ask about them.`]
      : []),
    `- Sidebar order now: ${settings.sidebar.filter((bay) => loaded.has(bay)).join(", ") || "no blocks"}${settings.sidebarList ? "" : " (the default)"}.`,
    "- Cockpit's settings files, JSONC (comments and trailing commas are fine). The project's file",
    "  wins over the global one key by key, and its `sidebar` list replaces the global list:",
    ...settings.files.map(fileLine),
    "",
    Object.keys(now).length === 0
      ? "Nothing is written in either file: every bay is on its defaults."
      : [
          "Written now, both files merged (defaults left out):",
          "",
          "```json",
          JSON.stringify(now, null, 2),
          "```",
        ].join("\n"),
    "",
    ...(old.length > 0
      ? [
          "## Fix these first",
          "",
          "Names from before 0.9. They are not read at all (each one is a `!` row in its bay), so the value",
          "under each is doing nothing. In the same file, move the value to the new name and remove the old:",
          "",
          ...old.map(noticeLine),
          "",
        ]
      : []),
    ...(rest.length > 0
      ? [
          "## Also not read",
          "",
          "Each is ignored, and says so with a `!` row:",
          "",
          ...rest.map(noticeLine),
          "",
        ]
      : []),
    "## The settings",
    "",
    `- \`sidebar\` (top level): the order of the sidebar blocks, top to bottom, a list of ${SIDEBAR_BAYS.map((bay) => `"${bay}"`).join(", ")}. Default ${json([...SIDEBAR_BAYS])}. A bay left out follows the named ones in default order. Only an order: it shows nothing that is off.`,
    `- \`features\` (top level): \`{ "<bay>": false }\` turns a bay off. Bays: ${BAYS.join(", ")}.`,
    `- One section per bay, \`"<bay>": { … }\`, merged key by key. Every section takes the same keys:`,
    ...SHARED_KEYS.map((key) => `  - \`${key}\`: ${SHARED_ABOUT[key]}.`),
    "",
    `Defaults of the block keys (${BAYS.filter((bay) => !isSidebarBay(bay)).join(" and ")} have no block):`,
    "",
    ...table,
    "",
    ...(ownKeys.length > 0
      ? [
          "Each loaded bay's own keys and defaults. Change these only if I ask; the bay's README says what each does:",
          "",
          ...ownKeys,
          "",
        ]
      : []),
    `Old names, not read anywhere (a plugin entry's options included): ${OLD_NAMES.map((name) => `\`${name.old}\` → \`${name.new}\``).join(", ")}.`,
    "",
    ...hostSection(report, loaded),
    "## Ask me first, one question at a time",
    "",
    ...questions(loaded).map((question, at) => `${at + 1}. ${question}`),
    "",
    "Skip a question when I have already answered it. Keys and anything else only if I bring them up.",
    "",
    "## Then",
    "",
    "- Edit only the Cockpit file I picked, as JSONC: keep its comments, write only what differs from the defaults, and create the file (and its folder) if it does not exist.",
    ...(old.length > 0 ? ['- In the same edit, fix every old name under "Fix these first".'] : []),
    "- Tell me what changed, key by key. Cockpit reads its settings when OpenCode starts: they apply after I restart OpenCode.",
    "",
    "Ask me what I want before you edit anything.",
  ].join("\n")
}

// ── The command ────────────────────────────────────────────────────────────────────────────────

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
export function briefAgent(host: Host, text: string, title: string, done = "Briefed the agent."): void {
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
   * which cut a reply off mid-sentence to start on this; queued, the reply finishes and the brief
   * shows as `1 queued` under the conversation — what v1 does with a prompt submitted while busy.
   */
  const busy = session?.status?.(id) === "running"
  await session?.prompt?.({ sessionID: id, text, ...(busy ? { delivery: "queue" as const } : {}) })
  return id
}

/**
 * `/cockpit-setup`, once per window. Every Cockpit entry calls this as it starts; the first claims
 * the command, and the list of bays is read from the window's claims when it runs, so it names
 * whatever loaded — including bays that start after it.
 */
export function registerSetup(host: Host, source: string): void {
  const claim = claimFeature(host.renderer, "setup", source)
  if (!claim.active) return
  host.lifecycle.onDispose(() => claim.release())
  const send = () => {
    const report = buildSetupReport({
      opencode: host.version,
      directory: host.state.path.directory,
      claims: claimedFeatures(host.renderer),
      bays: baysRead(),
    })
    host.log.info("setup: brief", {
      loaded: report.loaded.map((each) => each.bay),
      notices: report.notices.length,
    })
    briefAgent(host, setupBrief(report), "Cockpit setup")
  }
  host.keymap.registerLayer({
    commands: [
      {
        name: "cockpit.setup",
        title: "Ask the agent to set up Cockpit",
        desc: "which bays show, where, in what order",
        category: "Cockpit",
        namespace: "palette",
        slashName: SETUP_SLASH,
        run: send,
      },
    ],
  } as never)
}
