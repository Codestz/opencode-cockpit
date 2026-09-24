import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolvePaths } from "@opencode-cockpit/protocol"

/**
 * What Cockpit did inside OpenCode, as JSON lines in `<cockpit home>/cockpit.log` — both halves, every
 * bay, one file, beside the daemon's `cockpitd.log` and in the same shape, so the two read as one story.
 *
 * Inside OpenCode a bay has nowhere else to say anything: stderr is the terminal the interface draws
 * on, and a toast is gone before it is read. So errors are always written, with their stack, and
 * `COCKPIT_DEBUG=1` adds everything else — keys, paints, config reads — for the one machine where
 * something happens that happens nowhere else.
 *
 *   { "t": "…", "lvl": "error", "scope": "tui:review", "msg": "paint failed", "pid": 123, "error": {…} }
 *
 * Synchronous, so the last lines survive a crash, and swallowed: a log line that can break the
 * interface is worse than none.
 */

export type Level = "debug" | "info" | "warn" | "error"
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Log {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  /** The same log under a narrower scope: `tui` → `tui:shell`. */
  child(scope: string): Log
  /** Where it writes, for a message that says where to look. Undefined when it cannot write. */
  readonly file: string | undefined
}

/** `COCKPIT_DEBUG=1` for everything; `COCKPIT_LOG_LEVEL` to pick; errors, warnings and starts otherwise. */
export function levelFrom(env: Record<string, string | undefined> = process.env): Level {
  const debug = env.COCKPIT_DEBUG
  if (debug && debug !== "0" && debug !== "false") return "debug"
  const named = env.COCKPIT_LOG_LEVEL as Level | undefined
  return named && named in ORDER ? named : "info"
}

/** Past this, the file moves to `cockpit.log.1` — one generation kept, so a log never grows for ever. */
const ROTATE_BYTES = 5 * 1024 * 1024

/** `COCKPIT_LOG_FILE` moves it — tests point it away from the real one — else the cockpit home. */
export function logFile(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.COCKPIT_LOG_FILE) return env.COCKPIT_LOG_FILE
  try {
    return join(resolvePaths(env).home, "cockpit.log")
  } catch {
    return undefined
  }
}

/** Errors do not survive `JSON.stringify`; their message and stack are what a report needs. */
function serialise(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { message: value.message, stack: value.stack } : value
  }
  return out
}

/** Files already prepared in this process: once per file is enough. */
const checked = new Set<string>()

/**
 * The directory, then the size. On a fresh machine the cockpit home does not exist until the daemon
 * first starts — and the plugin's first lines, which say what loaded, come before that: they were
 * written to a directory that was not there yet, and lost.
 */
function prepare(file: string): void {
  if (checked.has(file)) return
  checked.add(file)
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  } catch {
    // unwritable: the append below fails and is swallowed like any other
  }
  try {
    if (statSync(file).size > ROTATE_BYTES) renameSync(file, `${file}.1`)
  } catch {
    // no file yet, or it cannot be moved: either way, keep writing
  }
}

export interface LogOptions {
  file?: string
  level?: Level
}

export function createLog(scope: string, options: LogOptions = {}): Log {
  const file = "file" in options ? options.file : logFile()
  const level = options.level ?? levelFrom()
  const write = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (!file || ORDER[lvl] < ORDER[level]) return
    try {
      prepare(file)
      const line = { t: new Date().toISOString(), lvl, scope, msg, pid: process.pid, ...serialise(fields) }
      appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 })
    } catch {
      // Never let a log line take the interface down.
    }
  }
  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child: (name) => createLog(`${scope}:${name}`, { file, level }),
    file,
  }
}

/** Logs nothing: for tests, and for code handed no log. */
export const silentLog: Log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLog,
  file: undefined,
}

/** This package's version — `../package.json` from both `src/` and `dist/`. */
export function cockpitVersion(): string | undefined {
  try {
    return (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }
    ).version
  } catch {
    return undefined
  }
}
