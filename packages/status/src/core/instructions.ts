/**
 * The brief `/statusline` hands to the agent.
 *
 * The command draws nothing. Customising a statusline is an editing job — a JSON file the TUI never
 * names, or a TypeScript module against an api that is written down only on a website — so the
 * useful thing to put on screen is not a help panel the user then has to act on themselves. It is a
 * message to the agent already sitting in the session, carrying the facts it cannot look up: which
 * config file this project actually reads, what is in it right now, and where the taste rules live.
 *
 * Plain text rather than a UI also means the same brief works from anywhere the agent can be asked
 * a question, and can be tested as a string.
 */

import { BUILTINS } from "./builtins/index.ts"
import { PRESETS } from "./config.ts"
import type { StatusReport } from "./report.ts"

/** The file an edit should go to: the project's if it exists, else the one for every project. */
export function targetConfig(report: StatusReport): { path: string; exists: boolean } {
  const project = report.sources[1]
  const global = report.sources[0]
  const chosen = project?.found ? project : (global ?? project)
  return { path: chosen?.path ?? "", exists: chosen?.found ?? false }
}

export function statuslineBrief(report: StatusReport): string {
  const target = targetConfig(report)
  const drawing =
    report.lines.length === 0
      ? "nothing — no line is configured"
      : report.lines
          .map(
            (line) =>
              `${line.surface} (${line.stack}), ${line.segments} segment${line.segments === 1 ? "" : "s"}`,
          )
          .join("; ")
  const modules =
    report.modules.listed.length === 0
      ? "none"
      : `${report.modules.listed.join(", ")} — ${report.modules.registered} segment${report.modules.registered === 1 ? "" : "s"} registered`

  return [
    "Help me customise my opencode-cockpit statusline.",
    "",
    "## Where it stands",
    "",
    `- Config to edit: ${target.path}${target.exists ? "" : " (does not exist yet — create it)"}`,
    `- Drawing now: ${drawing}`,
    `- My modules: ${modules}`,
    ...(report.modules.errors.length > 0
      ? ["- Failing to load:", ...report.modules.errors.map((error) => `  - ${error}`)]
      : []),
    `- Version: ${report.version}`,
    "",
    "## What you can change",
    "",
    'The config file holds `{ "statusline": { ... } }`. Two surfaces: `bottom` (a line under the',
    "prompt) and `sidebar` (a column). A whole line by name with `preset`, then anything written",
    "beside it wins:",
    "",
    ...Object.entries(PRESETS).map(
      ([name, preset]) => `- \`"preset": "${name}"\` — ${preset.about} (${preset.surface})`,
    ),
    "",
    `Built-in segment names: ${BUILTINS.map((segment) => segment.name).join(", ")}.`,
    'A segment can also be `{ "type": "...", ... }` with its own settings, or a shell command.',
    "",
    "For anything the built-ins do not cover, write a TypeScript module and list it in `modules`:",
    "it exports `{ segments: { name(ctx, config) { return { runs: [...] } } } }` against",
    "`@opencode-cockpit/status/segment`, is handed a snapshot rather than OpenCode's api, and is",
    "called on every repaint so it can keep history. Returning `undefined` hides a segment.",
    "",
    "## Before you say it is done",
    "",
    "Look at it. Do not edit, restart OpenCode and judge from a sentence:",
    "",
    "```sh",
    "bunx @opencode-cockpit/status preview --watch    # redraws on every save",
    "bunx @opencode-cockpit/status preview --debug    # mark segments that drew nothing",
    "bunx @opencode-cockpit/status preview --module <my module> --state full",
    "```",
    "",
    "The design rules are a skill shipped with the package at",
    "`node_modules/@opencode-cockpit/status/skills/statusline-design/SKILL.md` — read it before",
    "designing anything, and copy the examples beside it rather than inventing glyphs. The reference",
    "is https://codestz.github.io/opencode-cockpit/status/.",
    "",
    "Ask me what I want it to show before you edit anything.",
  ].join("\n")
}
