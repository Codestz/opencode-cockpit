/**
 * The `status-setup` skill's reference, written from the code: the `status` keys (from the catalog
 * every bay's reference comes from), the presets, every built-in segment and what each says. A test
 * fails when `skills/status-setup/references/settings.md` is not what `statusReference()` writes —
 * `bun packages/status/src/cli/reference.ts` writes it again.
 */

import { bayKeys, shownDefault } from "@opencode-cockpit/client/catalog"
import { BUILTINS } from "./builtins/index.ts"
import { DEFAULT_SURFACE, PRESETS, type SegmentConfig } from "./config.ts"

/**
 * What each built-in says, in a line, with the settings worth knowing. Keyed by name, so a built-in
 * added without a line here fails the reference's test rather than shipping undescribed.
 */
export const SEGMENT_ABOUT: Readonly<Record<string, string>> = {
  cwd: "the folder, shortened from the left (`maxWidth`, default 28)",
  "git.branch": "the branch; muted on the default branch",
  "git.diff": "what is uncommitted: `+added / -removed` (`format` with `{files}`, `{added}`, `{removed}`)",
  model: "the model, short (`full: true` for its whole id)",
  context:
    'how full the window is: `style` `"percent"` (default), `"bar"`, `"solid"` (the table\'s), `"split"` (cache, input, output in one bar); `width`, `warnAt` 0.75, `dangerAt` 0.9',
  tokens:
    'the token total; `format` with `{total}`, `{input}`, `{output}`, `{cacheRead}`, `{cacheWrite}`; `style` `"row"` (the table\'s) or `"parts"`',
  cost: "what the session cost, hidden when nothing is priced (`showZero`, `currency`)",
  title: 'the table\'s heading, "Context" (`text` to rename it)',
  in: "table row: fresh prompt tokens, with their share",
  out: "table row: output and reasoning tokens, with their share",
  cache: "table row: tokens read from cache, with their share",
  write: "table row: tokens written to cache, with their share",
  sep: "a hairline between groups; drawn only with a row on both sides",
  spend: "table row: a proxy's spend, from its budget file; silent without one",
  avail: "table row: what is left of a proxy's budget; silent without one",
  git: "table row: the branch's whole diff against its base",
  diagnostics: "errors and warnings from the language servers",
  version: "the Cockpit version",
  text: 'a fixed `value`: `{ "type": "text", "value": "hi" }`',
  command:
    'a shell command\'s output: `{ "type": "command", "name": "<one of commands>" }` (`row` for one line of many)',
  todo: "todo progress, `3/7`; hidden when all are done (`showComplete`)",
  "session.status": "why a turn stalled, `retry 2 in 5s`; silent otherwise",
  "session.time": 'how long: the session, or the last answer with `of: "turn"` (`coarse` for minutes)',
}

const segmentName = (segment: string | SegmentConfig) =>
  typeof segment === "string" ? segment : segment.type

/** `references/settings.md` of the `status-setup` skill, exactly. */
export function statusReference(): string {
  const cell = (text: string) => text.replaceAll("|", "\\|")
  return [
    "<!-- Written by `bun packages/status/src/cli/reference.ts` from the Status bay's code. Do not edit by hand: a test fails when this file and the code disagree. -->",
    "",
    "# Status settings reference",
    "",
    'Everything goes in the `"status"` section of `~/.config/opencode-cockpit/config.json` (every project) or',
    "`<project>/.cockpit.json` (this one). JSONC. Read when OpenCode starts: a change applies after a restart.",
    "`cockpit_settings` gives the exact paths and what is written now.",
    "",
    "## Keys",
    "",
    "| Key | Type | Default | What it does |",
    "| --- | --- | --- | --- |",
    ...bayKeys("status").map(
      (info) => `| \`${info.key}\` | ${cell(info.type)} | ${cell(shownDefault(info))} | ${info.about} |`,
    ),
    "",
    'A line in `"lines": [ … ]` takes `preset`, `surface`, `segments`, `separator`, `stack`, `icons`, `debug`,',
    "`maxRows` (its own row cap) and the paddings; anything a line leaves out comes from the section.",
    "",
    "## Presets",
    "",
    "A preset fills in what is not written; anything written beside it wins.",
    "",
    "| Preset | Surface | What it shows | Segments |",
    "| --- | --- | --- | --- |",
    ...Object.entries(PRESETS).map(
      ([name, preset]) =>
        `| \`${name}\` | ${preset.surface}${preset.surface === DEFAULT_SURFACE ? " (the default)" : ""} | ${preset.about} | ${preset.segments.map((segment) => `\`${segmentName(segment)}\``).join(" ")} |`,
    ),
    "",
    "## Built-in segments",
    "",
    'Write a name (`"cwd"`), or the name with settings (`{ "type": "context", "style": "bar" }`). Every',
    "segment also takes `prefix`, `suffix`, `priority` (higher survives a narrow line), `color` (a tone:",
    "`text muted accent success warning error info`, or `#rrggbb`) and `icon`.",
    "",
    "| Segment | What it says |",
    "| --- | --- |",
    ...BUILTINS.map((segment) => `| \`${segment.name}\` | ${cell(SEGMENT_ABOUT[segment.name] ?? "")} |`),
    "",
    "## Commands",
    "",
    "Any CLI's output as a segment — an existing Claude Code statusline script runs unchanged:",
    "",
    "```jsonc",
    '"commands": { "budget": { "run": "~/bin/budget.sh", "intervalMs": 2000, "timeoutMs": 1000 } },',
    '"segments": ["context", { "type": "command", "name": "budget" }]',
    "```",
    "",
    "`claudeCodeCompat` (default true) feeds the command Claude Code's statusline JSON on stdin.",
    "",
    "## Modules",
    "",
    "For what needs the session read, a decision, or memory across ticks (a rate, a trend): a TypeScript",
    'module listed in `"modules"`, exporting `{ segments: { name(ctx, config) { return { runs: [...] } } } }`',
    "against `@opencode-cockpit/status/segment`. It is handed a snapshot, not OpenCode's api, and called on",
    "every repaint; returning `undefined` hides the segment. Its segments are used by name like built-ins.",
    "",
  ].join("\n")
}
