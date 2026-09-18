import { z } from "zod"
import { ShellId } from "./common.ts"

/**
 * A watch rule is three regexes over a shell's log, not a parser: `done` marks the end of a run
 * (a compile, a test pass), `fail` and `ok` say how it went. Presets are just named rules, so a
 * new tool is a table entry or a rule in the caller's config — never new code.
 */
export const WatchRule = z.object({
  /** A run finished, e.g. "Found 3 errors." Without it, `idleSeconds` ends the run. */
  done: z.string().min(1).max(500).optional(),
  /** Something in this run failed. */
  fail: z.string().min(1).max(500).optional(),
  /** This run was clean; beats `fail` only when `fail` never matched. */
  ok: z.string().min(1).max(500).optional(),
  ignoreCase: z.boolean().optional(),
  /** Treat this much silence as the end of a run when `done` is absent. */
  idleSeconds: z.number().positive().max(3600).optional(),
})

export const WatchStatus = z.enum(["ok", "fail", "pending", "unknown"])

export const WatchState = z.object({
  /** Preset that produced the rule, when one was used. */
  preset: z.string().optional(),
  status: WatchStatus,
  /** Line that decided the current status. */
  summary: z.string().optional(),
  /** Completed runs seen since watching started. */
  runs: z.number().int(),
  /** When the status last changed. */
  since: z.number(),
})

export const WatchParams = z.object({
  id: ShellId,
  /** Named rule, or "auto" to pick one from the command. Ignored when `rule` is given. */
  preset: z.string().min(1).optional(),
  rule: WatchRule.optional(),
})

export type WatchRule = z.output<typeof WatchRule>
export type WatchState = z.output<typeof WatchState>
export type WatchStatus = z.output<typeof WatchStatus>
export type WatchParams = z.output<typeof WatchParams>
