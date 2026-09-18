import type { ToolDefinition } from "@opencode-ai/plugin"
import { shellList } from "./list.ts"
import { shellRead } from "./read.ts"
import { shellRestart } from "./restart.ts"
import { shellSend } from "./send.ts"
import { createToolKit, type ToolDeps } from "./shared.ts"
import { shellStart } from "./start.ts"
import { shellStop } from "./stop.ts"
import { shellWait } from "./wait.ts"
import { shellWatch } from "./watch.ts"

export type { ToolDeps } from "./shared.ts"

/** The shell tools an agent sees. One file per tool; `shared.ts` holds what they have in common. */
export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  const kit = createToolKit(deps)
  return {
    shell_start: shellStart(kit),
    shell_read: shellRead(kit),
    shell_send: shellSend(kit),
    shell_wait: shellWait(kit),
    shell_watch: shellWatch(kit),
    shell_list: shellList(kit),
    shell_stop: shellStop(kit),
    shell_restart: shellRestart(kit),
  }
}
