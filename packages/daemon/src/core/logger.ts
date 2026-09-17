import { appendFileSync } from "node:fs"

export type Level = "debug" | "info" | "warn" | "error"
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  child(scope: string): Logger
}

/** JSON-lines logger. Writes synchronously so the last lines survive a crash. */
export function createLogger(file: string | undefined, level: Level = "info", scope = "cockpitd"): Logger {
  const write = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (order[lvl] < order[level]) return
    const line = `${JSON.stringify({ t: new Date().toISOString(), lvl, scope, msg, ...fields })}\n`
    if (file) {
      try {
        appendFileSync(file, line, { mode: 0o600 })
      } catch {
        process.stderr.write(line)
      }
    } else if (lvl !== "debug") {
      process.stderr.write(line)
    }
  }
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (s) => createLogger(file, level, `${scope}:${s}`),
  }
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
}
