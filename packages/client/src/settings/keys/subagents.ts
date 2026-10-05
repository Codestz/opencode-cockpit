/** Subagents's own keys. Defaults equal what the bay hands `baySettings` (`packages/opencode/test/catalog.test.ts`). */

import type { KeyInfo } from "../catalog.ts"

export const SUBAGENTS_KEYS: readonly KeyInfo[] = [
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
]
