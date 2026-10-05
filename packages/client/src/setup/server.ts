/** The agent side: the `cockpit_settings` and `cockpit_conventions` tools, the skill and the command. */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { claimedFeatures, claimFeature } from "../feature.ts"
import type { ServerHost, ServerParts } from "../opencode/server/index.ts"
import { instructionPaths } from "./conventions/instructions.ts"
import { writeSection } from "./conventions/section.ts"
import { CONVENTIONS_TOOL, SETTINGS_TOOL, SETUP_PROMPT, SETUP_SKILL_DIR, SETUP_SLASH } from "./names.ts"
import { previewCommands } from "./previews.ts"
import { type ReportInput, readText, settingsReport } from "./report.ts"
import { settingsText } from "./text.ts"
import { conventionsReply, tuneFacts, tuneText } from "./tune.ts"

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
    execute: async (args, ctx) => {
      const input: ReportInput = {
        opencode: host.version,
        // The session's own directory where the host gives one: the project the person is in.
        directory: ctx?.directory || host.directory,
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
      const path = instructionPaths(ctx?.directory || host.directory, process.env, homedir())[args.file]
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
