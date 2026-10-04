/**
 * The snapshot a segment sees. Deliberately a plain object rather than the live plugin api: every
 * built-in is then a pure function of it, which is what makes the line testable without an
 * OpenCode to draw it in.
 */

import type { Budget } from "./budget.ts"
import type { DiffCounts } from "./diff.ts"

export interface TokenCounts {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface SessionSnapshot {
  id: string
  title?: string
  /** `retry` carries the attempt and when the next one is due. */
  status: "idle" | "busy" | "retry"
  retry?: { attempt: number; message: string; next: number }
  model?: {
    providerID: string
    modelID: string
    /** Absent for a provider whose context window nobody has declared. */
    contextLimit?: number
  }
  /** From the last assistant message: what is actually in the window right now. */
  tokens?: TokenCounts
  /**
   * Summed over the session. Zero for a provider with no declared prices — which is why the cost
   * segment reports whether prices exist rather than trusting the number.
   */
  cost: number
  /** False when no model in play has prices, so cost is 0 because nobody said otherwise. */
  priced: boolean
  messages: number
  /** When the session was created: how old the conversation is, not how long anything took. */
  startedAt?: number
  /**
   * The newest turn: from the prompt that started it to the last reply that finished. `endedAt` is
   * the latest reply to finish so far, so while the turn runs it marks a step, not the end — read
   * it together with `status`.
   */
  turn?: Turn
  /**
   * What is uncommitted in the working tree.
   *
   * Kept on the session for the sake of modules that already read `ctx.session.diff`, but it is no
   * longer the session's own doing: it mirrors `ctx.diff`, which git answers whether a conversation
   * is open or not.
   */
  diff: DiffCounts
  todo: { total: number; completed: number }
}

export interface Turn {
  startedAt: number
  endedAt?: number
}

/** A message as far as a turn is concerned. Both OpenCode versions carry these two times. */
export interface TimedMessage {
  role: "user" | "assistant" | "other"
  created?: number
  completed?: number
}

/**
 * The newest turn in a session's messages: the last prompt, and the last reply after it to finish.
 * A session with no prompt yet has no turn, and says nothing rather than zero.
 */
export function lastTurn(messages: readonly TimedMessage[]): Turn | undefined {
  const at = messages.findLastIndex((m) => m.role === "user" && m.created !== undefined)
  const startedAt = messages[at]?.created
  if (startedAt === undefined) return undefined
  let endedAt: number | undefined
  for (const message of messages.slice(at + 1)) {
    if (message.role !== "assistant" || message.completed === undefined) continue
    endedAt = Math.max(endedAt ?? message.completed, message.completed)
  }
  return endedAt === undefined ? { startedAt } : { startedAt, endedAt }
}

export interface ServiceSnapshot {
  name: string
  /** Anything but "connected"/"ready" reads as unhealthy. */
  status: string
}

export interface StatusContext {
  now: number
  /** OpenCode's current directory and the worktree root it sits in. */
  directory: string
  worktree: string
  home: string
  branch?: string
  defaultBranch?: string
  version: string
  /**
   * What is uncommitted, from git — absent until the first read comes back, and absent outside a
   * repository. A segment must tell "not yet" from "nothing changed": the first renders nothing,
   * the second renders zeros.
   */
  diff?: DiffCounts
  /**
   * The branch's whole diff against where it forked from the default branch: every commit on it plus
   * what is uncommitted — what a reviewer will read. Absent until git answers, and outside a repo.
   */
  branchDiff?: DiffCounts
  /** What a proxy reports spending against its cap. Absent when no proxy writes one. */
  budget?: Budget
  session?: SessionSnapshot
  lsp: ServiceSnapshot[]
  mcp: ServiceSnapshot[]
  /** Output of the configured commands, by name. Absent until the first run finishes. */
  commands: Record<string, string>
  /** Terminal width the line has to fit into. */
  width: number
}

/** Tokens that occupy the context window right now: everything the model reads back. */
export function contextUsed(tokens: TokenCounts | undefined): number {
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function contextRatio(session: SessionSnapshot | undefined): number | undefined {
  const limit = session?.model?.contextLimit
  if (!limit || limit <= 0 || !session?.tokens) return undefined
  return Math.min(1, contextUsed(session.tokens) / limit)
}

export function todoRemaining(session: SessionSnapshot | undefined): number {
  if (!session) return 0
  return Math.max(0, session.todo.total - session.todo.completed)
}

/**
 * A service's state as one word. OpenCode 1 hands a word; OpenCode 2 a tagged object —
 * `{ status: "connected" }`, `{ status: "failed", error }` — which `String()` turned into
 * `[object Object]`, so every connected MCP server read as broken (issue #34).
 */
export function serviceStatus(raw: unknown): string {
  if (typeof raw === "string") return raw
  const tagged = raw && typeof raw === "object" ? (raw as { status?: unknown }).status : undefined
  return typeof tagged === "string" ? tagged : ""
}

const HEALTHY = new Set(["connected", "ready", "ok", "running", "active"])
/**
 * Not working, and not wrong: turned off on purpose, or still connecting — OpenCode marks a server
 * that never connects `failed` once it gives up (measured: under a minute on 2.0.18). A missing word
 * is quiet too, since a false alarm in red is what #34 was; any other word, known or not, is an alarm.
 */
const QUIET = new Set(["disabled", "pending", "starting", "connecting", ""])

export function unhealthy(list: readonly ServiceSnapshot[]): ServiceSnapshot[] {
  return list.filter((item) => {
    const status = item.status.toLowerCase()
    return !HEALTHY.has(status) && !QUIET.has(status)
  })
}
