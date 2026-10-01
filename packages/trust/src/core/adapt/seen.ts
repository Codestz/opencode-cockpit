/**
 * What Trust takes from the host's events, whichever OpenCode sent them. `v1.ts` and `v2.ts` turn
 * their version's events into these, and nothing past them knows which version it is.
 */

import type { Reply } from "../engine.ts"
import type { Request } from "../keys.ts"

export type Seen =
  | { type: "asked"; request: Request }
  | { type: "replied"; sessionID: string; requestID: string; reply: Reply }
  /**
   * A tool call's arguments. A bash request's patterns lose the line's `cd`s (OpenCode leaves `cd`
   * out of them), so the command line Trust judges is the call's own `command`, kept from here.
   */
  | { type: "call"; sessionID: string; call: string; messageID?: string; input: Record<string, unknown> }
  /** The agent a session runs as: part of every key, and not on the request itself. */
  | { type: "agent"; sessionID: string; agent: string }
  /** OpenCode's config changed: the rules have to be read again. */
  | { type: "config" }

export type Json = Record<string, unknown>
export const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {}
export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

export const isReply = (value: unknown): value is Reply =>
  value === "once" || value === "always" || value === "reject"

/** The command line and working directory from a shell call's arguments (v1 `workdir`, v2 `cwd`). */
export function commandOf(input: Json | undefined): { line?: string; workdir?: string } {
  if (!input) return {}
  const line = str(input.command) ?? str(input.cmd)
  const workdir = str(input.workdir) ?? str(input.cwd)
  return { ...(line !== undefined ? { line } : {}), ...(workdir ? { workdir } : {}) }
}
