import { z } from "zod"
import { method } from "./contract.ts"

export const ShellId = z.string().regex(/^sh_[a-z2-7]{8}$/, "expected sh_ followed by 8 base32 chars")

export const Owner = z.object({
  /** Absolute project directory the shell belongs to. */
  project: z.string().min(1),
  /** OpenCode session that started it, when started by an agent. */
  session: z.string().min(1).optional(),
  /** Opaque id of the client instance that started it; used to route notifications to one place. */
  instance: z.string().min(1).optional(),
})

export const ShellStatus = z.enum(["running", "exited", "killed", "failed"])

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
})

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
  /** Stop the shell automatically after this long. */
  timeoutMs: z.number().int().positive().optional(),
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

export const ScreenResult = z.object({
  text: z.string(),
  cols: z.number().int(),
  rows: z.number().int(),
  cursor: z.object({ x: z.number().int(), y: z.number().int() }),
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

export const shellContract = {
  "shell.start": method(StartParams, ShellInfo),
  "shell.list": method(ListParams, z.array(ShellInfo)),
  "shell.get": method(IdParams, ShellInfo),
  "shell.read": method(ReadParams, ReadResult),
  "shell.screen": method(IdParams, ScreenResult),
  "shell.write": method(WriteParams, z.object({ bytes: z.number().int() })),
  "shell.resize": method(ResizeParams, z.object({})),
  "shell.wait": method(WaitParams, WaitResult),
  "shell.stop": method(StopParams, ShellInfo),
  "shell.restart": method(IdParams, ShellInfo),
  "shell.remove": method(IdParams, z.object({})),
  "shell.clear": method(ClearParams, z.object({ removed: z.array(ShellId) })),
  "shell.attach": method(AttachParams, z.object({ offset: z.number().int(), replay: z.string() })),
  "shell.detach": method(IdParams, z.object({})),
}

export const shellEvents = {
  "shell.started": ShellInfo,
  "shell.exited": ShellInfo,
  "shell.removed": z.object({ id: ShellId }),
  "shell.output": z.object({ id: ShellId, offset: z.number().int(), data: z.string() }),
}

export type Owner = z.output<typeof Owner>
export type ShellStatus = z.output<typeof ShellStatus>
export type ShellInfo = z.output<typeof ShellInfo>
export type StartParams = z.output<typeof StartParams>
export type ReadParams = z.output<typeof ReadParams>
export type ReadResult = z.output<typeof ReadResult>
export type ScreenResult = z.output<typeof ScreenResult>
export type WaitParams = z.output<typeof WaitParams>
export type WaitResult = z.output<typeof WaitResult>
export type WaitReason = z.output<typeof WaitReason>
export type StopParams = z.output<typeof StopParams>
export type LogLine = z.output<typeof LogLine>
