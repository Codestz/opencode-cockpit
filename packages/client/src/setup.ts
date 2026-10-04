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
 *
 * This file is the `./setup` entry and only gathers the parts in `setup/`. The interface and the agent
 * side import their own part directly (`host.ts` the palette entry, `server.ts` the tools), so neither
 * loads the other's code.
 */

export { briefAgent } from "./brief.ts"
export { baysOfEntry } from "./plugin-entries.ts"
export { HOST_BLOCKS, type HostFile, hostFilePaths, readHostFile } from "./setup/host-blocks.ts"
export { type Install, opencodeConfigPaths, readInstalls } from "./setup/installs.ts"
export {
  CONVENTIONS_TOOL,
  SETTINGS_TOOL,
  SETUP_PROMPT,
  SETUP_SKILL,
  SETUP_SKILL_DIR,
  SETUP_SLASH,
} from "./setup/names.ts"
export { registerSetup } from "./setup/palette.ts"
export { offerPreview, previewCommands } from "./setup/previews.ts"
export {
  type BayState,
  type ReportInput,
  type ResolvedKey,
  type SettingsReport,
  type Source,
  settingsReport,
} from "./setup/report.ts"
export { setupServer } from "./setup/server.ts"
export { blockState, noticeLine, settingsText } from "./setup/text.ts"
export { bayCommands, conventionsReply, type TuneFacts, tuneFacts, tuneText } from "./setup/tune.ts"
