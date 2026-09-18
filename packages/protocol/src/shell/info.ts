import { z } from "zod"

import { Owner, ShellId, ShellStatus } from "./common.ts"
import { WatchState } from "./watch.ts"

export const ShellInfo = z.object({
  id: ShellId,
  title: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  owner: Owner,
  status: ShellStatus,
  run: z.number().int().positive(),
  pid: z.number().int().optional(),
  exitCode: z.number().int().optional(),
  signal: z.string().optional(),
  error: z.string().optional(),
  /** Set when a run ends: the last error-looking line of the run, else its last line. */
  summary: z.string().optional(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  cols: z.number().int(),
  rows: z.number().int(),
  lines: z.object({ first: z.number().int(), last: z.number().int() }),
  /** Absolute raw byte offset written so far (for UI attach/replay). */
  bytes: z.number().int(),
  /** Health reported by this shell's watcher, when one is attached. */
  watch: WatchState.optional(),
  /** File this shell's clean log is written to, when logging was requested. */
  logFile: z.string().optional(),
})

export type ShellInfo = z.output<typeof ShellInfo>
