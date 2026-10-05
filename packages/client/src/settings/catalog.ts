/**
 * Every setting Cockpit reads, with its type, its default and a line on what it does: the one list
 * that `cockpit_settings` resolves against and that the `cockpit-setup` skill's reference is written
 * from (`references/settings.md`, `bun packages/client/src/cli/reference.ts` writes it).
 *
 * The shared keys and their defaults come from the loader itself (`SHARED_DEFAULTS`). Each bay's own
 * keys live in that bay's package, which this one cannot import, so they are listed here — and a test
 * in `packages/opencode`, which depends on every bay, fails when a bay's own defaults and this list
 * disagree. The skill's reference fails a test of its own when it is not what `settingsReference()`
 * writes, so neither can rot without a red test.
 */

import { BAYS, type Bay, SHARED_DEFAULTS, type SharedSettings, SIDEBAR_BAYS } from "./index.ts"

export interface KeyInfo {
  key: string
  /** As a reader writes it: `boolean`, `number`, `"sidebar" | "bottom"`, `string[]`… */
  type: string
  /** What the bay uses when nothing sets it. `undefined` is "unset", which the bay reads as such. */
  default: unknown
  /** The default in words, where a value alone would mislead (`14 with the sidebar preset, else 8`). */
  defaultText?: string
  about: string
}

/** What each shared key does. Typed by the interface, so a key added there and not here fails to build. */
export const SHARED_ABOUT: Readonly<Record<keyof SharedSettings, string>> = {
  enabled: "the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools",
  keybinds: 'keys for its commands, `{ "<command>": "<key>" }`',
  sidebar:
    "draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work",
  sidebarRows: "rows the block lists before the rest fold into `+ N more`",
  hideWhenEmpty:
    "`true`: no block at all while there is nothing to list. `false`: the heading and `none yet`, so you can see the bay is there",
}

const SHARED_TYPE: Readonly<Record<keyof SharedSettings, string>> = {
  enabled: "boolean",
  keybinds: "object",
  sidebar: "boolean",
  sidebarRows: "number",
  hideWhenEmpty: "boolean",
}

/** What a bay is, in a line. */
export const BAY_ABOUT: Readonly<Record<Bay, string>> = {
  status: "the statusline: context, tokens, spend, git — a table in the sidebar, or a line under the prompt",
  subagents: "the subagents a conversation launched, live",
  shell: "background shells the agent started, with a dock under the chat and a console",
  trail: "what a conversation made or changed: PRs, branches, issues, links",
  trust: "what Trust answered for you instead of asking; its block is off by default",
  review: "the pane for reviewing changes; no sidebar block",
  updater: "checks for plugin updates once a day; no sidebar block",
}

/** Which shared keys each bay reads. Status has no `hideWhenEmpty` (it always has rows), Trust neither. */
const SHARED_KEYS: Readonly<Record<Bay, readonly (keyof SharedSettings)[]>> = {
  status: ["enabled", "sidebar", "sidebarRows"],
  subagents: ["enabled", "sidebar", "sidebarRows", "hideWhenEmpty", "keybinds"],
  shell: ["enabled", "sidebar", "sidebarRows", "hideWhenEmpty", "keybinds"],
  trail: ["enabled", "sidebar", "sidebarRows", "hideWhenEmpty", "keybinds"],
  trust: ["enabled", "sidebar", "sidebarRows", "keybinds"],
  review: ["enabled", "keybinds"],
  updater: ["enabled"],
}

/**
 * The keys each bay's commands take, by default — each bay's interface binds exactly these
 * (`defaultKeys`). Leader-prefixed and few; `<leader>` is OpenCode's own prefix, `ctrl+x` by default.
 * Every one is free on both OpenCodes (1.18.32's and 2.0.18's defaults) and in Cockpit: on 2 `w`
 * closes a tab and `i` shows image attachments, and `r` is redo on both.
 */
export const DEFAULT_KEYS: Readonly<Partial<Record<Bay, Readonly<Record<string, string>>>>> = {
  subagents: { "cockpit.subagents.open": "<leader>d" },
  shell: { "cockpit.shells.dock": "<leader>o", "cockpit.shells.console": "<leader>j" },
  trail: { "cockpit.trail.open": "<leader>f" },
  /** `p`, for permissions. */
  trust: { "cockpit.trust.ledger": "<leader>p" },
  review: { "cockpit.review.open": "<leader>v", "cockpit.review.place": "<leader>k" },
}

/** A bay's default keys, by command: none for a bay without commands. */
export const defaultKeys = (bay: Bay): Readonly<Record<string, string>> => DEFAULT_KEYS[bay] ?? {}

/** One thing a person can do with a bay: its command's key (from `DEFAULT_KEYS` and `keybinds`) and slash name. */
export interface BayCommand {
  /** The command's id, whose key `keybinds` sets — none for a command with no key. */
  command?: string
  /** Typed in the prompt, without the `/`. */
  slash?: string
  does: string
}

/**
 * What each bay offers a person, for the tour `/cockpit-setup` gives: the commands worth knowing, not
 * every one (Shell has eight; the panes list their own keys under `?`). Read off each bay's interface
 * entry; the agent-side commands (`/status-setup`, `/cockpit-setup`) are its server's.
 */
export const BAY_COMMANDS: Readonly<Record<Bay, readonly BayCommand[]>> = {
  status: [{ slash: "status-setup", does: "design what the line shows, with the agent" }],
  subagents: [
    {
      command: "cockpit.subagents.open",
      slash: "subagents",
      does: "follow each subagent live, message it, stop it, move it to the background",
    },
  ],
  shell: [
    {
      command: "cockpit.shells.dock",
      slash: "shells-dock",
      does: "show or hide the shells panel under the chat",
    },
    {
      command: "cockpit.shells.console",
      slash: "shell",
      does: "open the console: a shell's live screen and log",
    },
    { slash: "shells", does: "pick a shell, or start one yourself" },
  ],
  trail: [
    {
      command: "cockpit.trail.open",
      slash: "trail",
      does: "what this conversation made, or every conversation's",
    },
    { slash: "link", does: "add a link to the trail yourself" },
  ],
  trust: [{ command: "cockpit.trust.ledger", slash: "trust", does: "what Trust answers for you, and why" }],
  review: [
    {
      command: "cockpit.review.open",
      slash: "changes",
      does: "the diff, with comments on its lines; `s` hands them to the agent",
    },
    { command: "cockpit.review.place", does: "the changes full screen" },
  ],
  updater: [{ slash: "plugins-update", does: "update every plugin (OpenCode 1)" }],
}

/**
 * Each bay's own keys. Defaults must equal what the bay hands `baySettings` — tested in
 * `packages/opencode/test/catalog.test.ts` against every bay's own `DEFAULTS`.
 */
export const OWN_KEYS: Readonly<Record<Bay, readonly KeyInfo[]>> = {
  status: [
    {
      key: "surface",
      type: '"sidebar" | "bottom"',
      default: undefined,
      defaultText: '"sidebar"',
      about: 'where the line draws; `"sidebar": false` says `"bottom"` too',
    },
    {
      key: "preset",
      type: "string",
      default: undefined,
      defaultText: "the surface's own: `sidebar` in the sidebar, `default` at the bottom",
      about: "a whole line by name; anything written beside it wins. The `status-setup` skill has them all",
    },
    {
      key: "segments",
      type: "list",
      default: undefined,
      defaultText: "the preset's",
      about:
        "the line's parts, built-ins or your own — the whole list, replacing the preset's. To change a row or two, `override`",
    },
    {
      key: "override",
      type: "object",
      default: undefined,
      defaultText: "none",
      about:
        'changes to the preset\'s segments by name, the rest kept: `false` drops one, a name swaps it, an object merges into its settings — `{ "git": { "against": "branch" } }`',
    },
    {
      key: "lines",
      type: "list",
      default: undefined,
      defaultText: "one line",
      about: "more than one line, each with its own `surface`, `segments`, `maxRows`…",
    },
    {
      key: "separator",
      type: "string",
      default: undefined,
      defaultText: '`" │ "` across, nothing down',
      about: "drawn between segments",
    },
    {
      key: "stack",
      type: '"horizontal" | "vertical"',
      default: undefined,
      defaultText: "vertical in the sidebar",
      about: "segments across or down",
    },
    {
      key: "icons",
      type: "boolean",
      default: true,
      about: "built-in icons; off for a terminal missing the glyphs",
    },
    {
      key: "debug",
      type: "boolean",
      default: false,
      about: "draw a placeholder where a segment said nothing",
    },
    {
      key: "paddingLeft",
      type: "number",
      default: undefined,
      defaultText: "3 at the bottom, 0 in the sidebar",
      about: "columns of space left of the line",
    },
    {
      key: "paddingRight",
      type: "number",
      default: undefined,
      defaultText: "2 at the bottom, 0 in the sidebar",
      about: "columns of space right of the line",
    },
    {
      key: "paddingTop",
      type: "number",
      default: undefined,
      defaultText: "0",
      about: "rows of space above the line",
    },
    {
      key: "paddingBottom",
      type: "number",
      default: undefined,
      defaultText: "1 at the bottom, 0 in the sidebar",
      about: "rows of space below the line",
    },
    {
      key: "commands",
      type: "object",
      default: undefined,
      defaultText: "none",
      about: "shell commands usable as segments — a Claude Code statusline script works unchanged",
    },
    {
      key: "modules",
      type: "string[]",
      default: undefined,
      defaultText: "none",
      about: "your own segments in TypeScript; a project's add to the global ones",
    },
  ],
  subagents: [
    {
      key: "hideFinishedAfterMinutes",
      type: "number",
      default: undefined,
      defaultText: "unset: kept for the conversation",
      about: "minutes a finished subagent stays in the sidebar (still reachable from `/subagents`)",
    },
    {
      key: "hideNestedAfterSeconds",
      type: "number",
      default: 30,
      about: "seconds a finished nested subagent stays in the sidebar; negative keeps them",
    },
    {
      key: "guidance",
      type: "boolean",
      default: true,
      about: "tell the agent how to follow, wait on and read its subagents (system prompt)",
    },
  ],
  shell: [
    {
      key: "hideFinishedAfterMinutes",
      type: "number",
      default: 30,
      about: "minutes a finished shell stays in the folded views",
    },
    { key: "dockHeight", type: "number", default: 14, about: "rows of the shells panel under the chat" },
    {
      key: "dockOpen",
      type: "boolean",
      default: undefined,
      defaultText: "as you last left it",
      about: "the panel starts open",
    },
    {
      key: "defaultView",
      type: '"screen" | "log"',
      default: "screen",
      about: "what the console opens on: the live screen or the clean log",
    },
    { key: "colors", type: "boolean", default: true, about: "paint the colours programs print" },
    {
      key: "guidance",
      type: "boolean",
      default: true,
      about: "tell the agent how to use shells (system prompt, ~120 tokens)",
    },
    {
      key: "listRunningShells",
      type: "number",
      default: 15,
      about: "running shells named in the system prompt each turn; `0` off",
    },
    {
      key: "lifecycle",
      type: "object",
      default: {},
      defaultText: '`onExit: "stopMine"`, `orphanAfterMinutes: 60`, `removeFinishedAfterMinutes: 30`',
      about:
        'when shells end: `onExit` (`"stopMine"` or `"keep"`, which survives a restart) and the two timers',
    },
    {
      key: "defaults",
      type: "object",
      default: {},
      defaultText: "none",
      about:
        "applied to every shell the agent starts: `watch`, `logFile`, `idleTimeoutSeconds`, `timeoutSeconds`, `notifyOnExit`",
    },
    {
      key: "notify",
      type: "object",
      default: {},
      defaultText: "`exit: true`, `watch: true`, `tailLines: 15`",
      about: "what may interrupt the agent",
    },
    {
      key: "watch",
      type: "object",
      default: {},
      defaultText: "`auto: false`",
      about: "health watching: `presets` (your own rules), `auto` (attach one to every shell)",
    },
    {
      key: "kinds",
      type: "object",
      default: {},
      defaultText: "none",
      about: "your own shell categories, name → regular expression on the command",
    },
  ],
  trail: [],
  trust: [
    {
      key: "threshold",
      type: "number",
      default: 3,
      about: "approvals in a row, by you, before Trust answers",
    },
    { key: "dangerExtra", type: "number", default: 5, about: "what a dangerous command costs on top" },
    {
      key: "expireDays",
      type: "number",
      default: 30,
      about: "days unused before trust has to be earned again; `0` never",
    },
  ],
  review: [
    { key: "variant", type: '"right" | "full"', default: "right", about: "where the pane opens" },
    {
      key: "source",
      type: '"worktree" | "branch"',
      default: "worktree",
      about: "what it reviews on open: uncommitted work, or the whole branch",
    },
  ],
  updater: [
    {
      key: "updateCheck",
      type: "boolean",
      default: true,
      about: "check for plugin updates once a day and say so",
    },
  ],
}

/** Status's block holds up to 14 rows with its `sidebar` preset; the loader's 8 is any other column's. */
const SHARED_DEFAULT_TEXT: Readonly<Partial<Record<Bay, Partial<Record<keyof SharedSettings, string>>>>> = {
  status: { sidebarRows: "14 with the `sidebar` preset, else 8", sidebar: "true (the table in the sidebar)" },
}

/** Every key a bay reads, shared first, with its default. */
export function bayKeys(bay: Bay): KeyInfo[] {
  const shared = SHARED_KEYS[bay].map((key): KeyInfo => {
    const text = SHARED_DEFAULT_TEXT[bay]?.[key]
    const keys = DEFAULT_KEYS[bay]
    return {
      key,
      type: SHARED_TYPE[key],
      default: key === "keybinds" ? (keys ?? {}) : SHARED_DEFAULTS[bay][key],
      ...(text ? { defaultText: text } : {}),
      about: SHARED_ABOUT[key],
    }
  })
  return [...shared, ...OWN_KEYS[bay]]
}

/** A default as a reader reads it: `true`, `8`, `"right"`, or the words for one that is unset. */
export function shownDefault(info: Pick<KeyInfo, "default" | "defaultText">): string {
  if (info.defaultText) return info.defaultText
  const value = info.default
  if (value === undefined) return "unset"
  if (typeof value === "object" && value !== null && Object.keys(value).length === 0) return "none"
  if (typeof value === "object" && value !== null)
    return Object.entries(value)
      .map(([key, each]) => `\`${key}\`: \`${each}\``)
      .join(", ")
  return `\`${JSON.stringify(value)}\``
}

// ── The skill's reference ──────────────────────────────────────────────────────────────────────

/** `references/settings.md` of the `cockpit-setup` skill, exactly. */
export function settingsReference(): string {
  const table = (bay: Bay) => [
    "| Key | Type | Default | What it does |",
    "| --- | --- | --- | --- |",
    ...bayKeys(bay).map(
      (info) =>
        `| \`${info.key}\` | ${info.type.replaceAll("|", "\\|")} | ${shownDefault(info).replaceAll("|", "\\|")} | ${info.about} |`,
    ),
  ]
  return [
    "<!-- Written by `bun packages/client/src/cli/reference.ts` from packages/client/src/settings/catalog.ts. Do not edit by hand: a test fails when this file and the code disagree. -->",
    "",
    "# Cockpit settings reference",
    "",
    "Two files, both JSONC (comments and trailing commas are fine), the same shape:",
    "",
    "- global, every project: `~/.config/opencode-cockpit/config.json` (`$XDG_CONFIG_HOME/opencode-cockpit/config.json` when that is set)",
    "- one project: `<project>/.cockpit.json`, which wins over the global file key by key",
    "",
    "Plugin-entry options win over both, but put settings in the files: on OpenCode 1 a plugin entry's",
    "options are split across `opencode.json` and `tui.json`. `cockpit_settings` gives the exact paths.",
    "Settings are read when OpenCode starts: a change applies after a restart.",
    "",
    "## The top level",
    "",
    "| Key | Type | Default | What it does |",
    "| --- | --- | --- | --- |",
    `| \`sidebar\` | list of ${SIDEBAR_BAYS.map((bay) => `\`"${bay}"\``).join(", ")} | \`${JSON.stringify([...SIDEBAR_BAYS])}\` | the order of the sidebar blocks, top to bottom. A bay left out keeps its default place after the named ones. A project's list replaces the global one. Only an order: it turns nothing on or off |`,
    `| \`features\` | \`{ "<bay>": false }\` | all on | turns a bay off, like its \`enabled: false\` |`,
    `| \`"<bay>"\` | object | | one section per bay: ${BAYS.map((bay) => `\`${bay}\``).join(", ")} |`,
    "",
    "## `enabled` and `sidebar` are different switches",
    "",
    "- `enabled: false` turns the bay off: no block, no commands, no agent tools. Use it for a bay you do not want at all.",
    "- `sidebar: false` hides only the bay's block. The bay keeps working: its commands, panes and agent tools stay.",
    '  For Status, `"sidebar": false` moves its line under the prompt (`"surface": "bottom"`).',
    "- `hideWhenEmpty: true` keeps the block but draws nothing while there is nothing to list.",
    "",
    ...BAYS.flatMap((bay) => [`## \`${bay}\` — ${BAY_ABOUT[bay]}`, "", ...table(bay), ""]),
  ].join("\n")
}
