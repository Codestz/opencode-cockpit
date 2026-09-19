/**
 * The snapshot a segment sees. Deliberately a plain object rather than the live plugin api: every
 * built-in is then a pure function of it, which is what makes the line testable without an
 * OpenCode to draw it in.
 */

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
  startedAt?: number
  diff: { files: number; additions: number; deletions: number }
  todo: { total: number; completed: number }
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

const HEALTHY = new Set(["connected", "ready", "ok", "running", "active"])

export function unhealthy(list: readonly ServiceSnapshot[]): ServiceSnapshot[] {
  return list.filter((item) => !HEALTHY.has(item.status.toLowerCase()))
}
