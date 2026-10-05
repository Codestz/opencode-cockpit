/**
 * The second phase: making it fit how the person works.
 *
 * Asked for with `cockpit_settings({ tune: true })`, after the blocks are set: a tour of what each
 * installed bay does for the person, with the keys as they are set now; what the project runs that
 * never ends; the ticket keys its history uses; and what each AGENTS.md says now. The conventions
 * themselves are written by `cockpit_conventions` (conventions.ts).
 */

import { homedir } from "node:os"
import { BAY_ABOUT, BAY_COMMANDS, DEFAULT_KEYS } from "../settings/catalog.ts"
import { type InstructionFile, readInstructions } from "./conventions/instructions.ts"
import { type GitRun, type ProjectFacts, projectFacts } from "./conventions/project.ts"
import { findSections, sectionText, type WriteAction, type Written } from "./conventions/section.ts"
import { isObject } from "./installs.ts"
import { CONVENTIONS_TOOL } from "./names.ts"
import { type BayState, type ReportInput, readText, type SettingsReport } from "./report.ts"

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
