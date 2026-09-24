import { z } from "zod"

import { Owner, ShellId, ShellStatus } from "./common.ts"
import { ShellInfo } from "./info.ts"

const Dimension = z.number().int().min(2).max(1000)

export const StartParams = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  title: z.string().min(1).max(200).optional(),
  cols: Dimension.default(120),
  rows: Dimension.default(32),
  owner: Owner,
  /** Stop the shell automatically after this long, however busy it is. */
  timeoutMs: z.number().int().positive().optional(),
  /**
   * Stop the shell after this much silence. Never a default: a dev server is idle by definition,
   * and killing one for being quiet would be wrong.
   */
  idleTimeoutMs: z.number().int().positive().optional(),
  /** Also write the clean log to a file, for debugging after the buffer has evicted old lines. */
  logFile: z.boolean().default(false),
  /** Stop this shell when the OpenCode window that started it goes away. */
  stopOnExit: z.boolean().optional(),
  /**
   * Stop it after this long with nothing from its window connected. The answer to a shell that
   * would otherwise run for a week because everyone who knew about it has gone.
   */
  orphanAfterMs: z.number().int().positive().optional(),
  /**
   * Forget this shell this long after it exits cleanly (exit 0). A shell that failed or was killed
   * is kept until someone clears it: that is the one worth reading afterwards.
   */
  removeAfterMs: z.number().int().positive().optional(),
  /**
   * Restart a finished shell with the same command, args, cwd, project and session instead of
   * creating a new one. Repeated runs then share one id and one log.
   */
  reuse: z.boolean().default(false),
})

export const ClearParams = z
  .object({
    owner: Owner.partial().optional(),
    /** Only remove shells that finished at least this long ago. */
    finishedBeforeMs: z.number().int().min(0).optional(),
  })
  .default({})

export const ListParams = z
  .object({
    owner: Owner.partial().optional(),
    includeExited: z.boolean().default(true),
  })
  .default({ includeExited: true })

export const IdParams = z.object({ id: ShellId })

export const LogLine = z.object({ n: z.number().int(), text: z.string() })

export const ReadParams = z.object({
  id: ShellId,
  /** Cursor: return only lines numbered strictly greater than this. */
  after: z.number().int().min(0).optional(),
  /** When no cursor is given, return the last N lines. */
  tail: z.number().int().positive().max(10_000).default(100),
  limit: z.number().int().positive().max(10_000).default(500),
  grep: z.string().min(1).max(500).optional(),
  ignoreCase: z.boolean().default(false),
})

export const ReadResult = z.object({
  lines: z.array(LogLine),
  firstLine: z.number().int(),
  lastLine: z.number().int(),
  /** Pass as `after` to continue. */
  nextCursor: z.number().int(),
  /** True when requested lines were already evicted. */
  truncated: z.boolean(),
  /** True when more lines exist beyond `limit`. */
  hasMore: z.boolean(),
  status: ShellStatus,
})

/** A run of characters sharing one style, so a UI can repaint colour without parsing escapes. */
export const ScreenRun = z.object({
  text: z.string(),
  /** Resolved "#rrggbb"; absent means the viewer's default foreground. */
  fg: z.string().optional(),
  bg: z.string().optional(),
  bold: z.boolean().optional(),
  dim: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
})

export const ScreenParams = z.object({
  id: ShellId,
  /**
   * Also send up to this many rows of scrollback above the viewport. The console asks for it only
   * while you are scrolled up; following the bottom needs the viewport alone.
   */
  history: z.number().int().min(0).max(10_000).optional(),
})

export const ScreenResult = z.object({
  text: z.string(),
  cols: z.number().int(),
  rows: z.number().int(),
  cursor: z.object({ x: z.number().int(), y: z.number().int() }),
  /** The same rows as `text`, carrying colour. */
  styled: z.array(z.array(ScreenRun)).optional(),
  /** How many of the rows are scrollback above the viewport (0 without `history`). */
  history: z.number().int().optional(),
})

export const WriteParams = z.object({ id: ShellId, data: z.string().max(1_000_000) })

export const ResizeParams = z.object({ id: ShellId, cols: Dimension, rows: Dimension })

export const WaitUntil = z
  .object({
    pattern: z.string().min(1).max(500).optional(),
    ignoreCase: z.boolean().optional(),
    exit: z.boolean().optional(),
    idleMs: z.number().int().positive().optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    host: z.string().optional(),
  })
  .refine((u) => u.pattern !== undefined || u.exit || u.idleMs !== undefined || u.port !== undefined, {
    message: "until needs at least one of pattern, exit, idleMs, port",
  })

export const WaitParams = z.object({
  id: ShellId,
  until: WaitUntil,
  timeoutMs: z.number().int().positive().max(3_600_000),
  /** Only consider lines after this cursor for `pattern`. Defaults to the current last line. */
  after: z.number().int().min(0).optional(),
})

export const WaitReason = z.enum(["pattern", "exit", "idle", "port", "timeout"])

export const WaitResult = z.object({
  reason: WaitReason,
  match: LogLine.optional(),
  info: ShellInfo,
})

export const StopParams = z.object({
  id: ShellId,
  signal: z.enum(["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL"]).default("SIGTERM"),
  graceMs: z.number().int().min(0).max(60_000).default(3000),
})

export const AttachParams = z.object({ id: ShellId, fromOffset: z.number().int().min(0).optional() })

export type StartParams = z.output<typeof StartParams>
export type ReadParams = z.output<typeof ReadParams>
export type ReadResult = z.output<typeof ReadResult>
export type ScreenParams = z.output<typeof ScreenParams>
export type ScreenResult = z.output<typeof ScreenResult>
export type ScreenRun = z.output<typeof ScreenRun>
export type WaitParams = z.output<typeof WaitParams>
export type WaitResult = z.output<typeof WaitResult>
export type WaitReason = z.output<typeof WaitReason>
export type StopParams = z.output<typeof StopParams>
export type LogLine = z.output<typeof LogLine>
