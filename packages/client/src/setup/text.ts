/** The tool's answer: the report as text the agent acts on. */

import { BAY_ABOUT, shownDefault } from "../catalog.ts"
import {
  isSidebarBay,
  OPTIONS_SOURCE,
  type Settings,
  type SettingsNotice,
  type SidebarBay,
} from "../settings.ts"
import { HOST_BLOCKS } from "./host-blocks.ts"
import type { BayState, ResolvedKey, SettingsReport } from "./report.ts"

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
  const text = notice.text.replace(/ — run \/cockpit-setup$/, "")
  /** A bay's own words may end in a question (`did you mean "git"?`): no full stop after it. */
  return `- ${where}: ${text}${/[.?!]$/.test(text) ? "" : "."}`
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
