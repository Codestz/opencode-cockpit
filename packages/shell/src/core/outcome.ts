import { STATE_WORD, type State } from "@opencode-cockpit/client/design"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"

/**
 * Where a shell stands, as a person and the agent both read it: derived from status and exit code
 * once, here, so the sidebar, the console and `shell_list` agree (docs/building/principles.md,
 * rule 2). `shell_list` used to print the protocol's own `exited` for a run that crashed with exit 1,
 * which the sidebar drew as failed.
 */
export type Kind = "run" | "fail" | "stop" | "done"

export function kindOf(s: ShellInfo): Kind {
  if (s.status === "running") return "run"
  if (s.status === "killed") return "stop"
  if (s.status === "exited" && s.exitCode === 0) return "done"
  return "fail"
}

/** A shell's kind in the words every bay shares, so it wears the tone and mark every bay does. */
export const STATE: Record<Kind, State> = { run: "running", fail: "failed", stop: "stopped", done: "done" }

/** The word for it: `running`, `failed`, `stopped`, `done`. */
export const stateWord = (s: ShellInfo): string => STATE_WORD[STATE[kindOf(s)]]
