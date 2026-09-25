/**
 * What a subagent did, in one vocabulary for both OpenCodes.
 *
 * OpenCode 1 says it as `message.part.updated` / `message.part.delta` / `session.status`; OpenCode 2
 * as `session.tool.called` / `session.reasoning.delta` / `session.execution.started`. The two
 * adapters in `tui/data/` translate each into these changes, and everything after them — the model,
 * the rows — is written once. Shapes measured from real runs (test/fixtures, docs/opencode/agents.md).
 *
 * `id` is always the session the change is about; a subagent *is* a session with a parent.
 */

export type ToolState = "pending" | "running" | "completed" | "failed"

export type Change =
  /** A session exists, or learned something about itself. Only fields present are applied. */
  | { type: "session"; id: string; parentID?: string; agent?: string; title?: string; at: number }
  /** Whether it is working. `waiting` is a permission or a question it is held on. */
  | { type: "status"; id: string; status: "busy" | "idle" | "failed" | "waiting"; error?: string; at: number }
  /** Something said *to* it: the first is the task it was given, the rest are messages. */
  | { type: "prompt"; id: string; key: string; text: string; at: number }
  /** Its thinking, whole (`text`) or as it streams (`delta`). `key` names one block of it. */
  | { type: "thinking"; id: string; key: string; text?: string; delta?: string; done?: boolean; at: number }
  /** What it is writing back, the same way. */
  | { type: "reply"; id: string; key: string; text?: string; delta?: string; done?: boolean; at: number }
  /** A tool call, as it moves from pending to done. `call` names it; later changes fill it in. */
  | {
      type: "tool"
      id: string
      call: string
      name?: string
      state?: ToolState
      input?: Record<string, unknown>
      /** What it returned — or, while running, what it has printed so far. */
      output?: string
      error?: string
      at: number
    }
  /** Running totals for the session, as the host keeps them. */
  | { type: "usage"; id: string; tokens?: number; cost?: number; at: number }

/** OpenCode 2 starts every subagent's task with this line; the task is what follows it. */
export const SUBAGENT_PREAMBLE = "You are a subagent spawned by another session."

export function taskText(text: string): string {
  const trimmed = text.startsWith(SUBAGENT_PREAMBLE) ? text.slice(SUBAGENT_PREAMBLE.length) : text
  return trimmed.trim()
}
