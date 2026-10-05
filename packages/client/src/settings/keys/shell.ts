/** Shell's own keys. Defaults equal what the bay hands `baySettings` (`packages/opencode/test/catalog.test.ts`). */

import type { KeyInfo } from "../catalog.ts"

export const SHELL_KEYS: readonly KeyInfo[] = [
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
]
