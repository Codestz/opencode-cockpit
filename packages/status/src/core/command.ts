/**
 * Running a shell command for a segment.
 *
 * Unlike Claude Code's statusline, this is not on the draw path: the command runs on its own
 * interval and the line renders whatever it last returned, so a slow script makes the value stale
 * rather than making the interface stutter.
 */

import { claudeCodeInput } from "./claude-code.ts"
import type { CommandConfig } from "./config.ts"
import type { StatusContext } from "./context.ts"

/**
 * What a command's output is worth keeping: every row, escapes and all.
 *
 * The colour escapes are deliberately *not* stripped — they are parsed into styled runs when the
 * segment draws, so a script someone already tuned for Claude Code looks the same here. Claude
 * Code statuslines may also print several rows, so the rows are kept rather than the first one.
 */
export function cleanOutput(stdout: string): string {
  return stdout.replace(/\r/g, "").replace(/\s+$/, "")
}

/** The rows of a command's last output. */
export function outputRows(value: string): string[] {
  return value.length === 0 ? [] : value.split("\n")
}

export interface CommandRunner {
  /** The last successful output, or "" until one arrives. */
  value(): string
  /** Runs if the interval has elapsed and no run is in flight. */
  maybeRun(ctx: StatusContext): void
  dispose(): void
}

export interface RunnerHost {
  /** Injected so tests do not need a shell. Resolves to stdout, or rejects. */
  exec(command: string, stdin: string, timeoutMs: number): Promise<string>
  now(): number
  onValue(): void
}

export function createRunner(config: CommandConfig, host: RunnerHost): CommandRunner {
  const interval = Math.max(250, config.intervalMs ?? 2000)
  const timeout = Math.max(100, config.timeoutMs ?? 1000)
  const compat = config.claudeCodeCompat !== false
  let value = ""
  let lastRun = Number.NEGATIVE_INFINITY
  let running = false
  let disposed = false

  return {
    value: () => value,
    maybeRun(ctx) {
      if (disposed || running || host.now() - lastRun < interval) return
      running = true
      lastRun = host.now()
      const stdin = compat ? JSON.stringify(claudeCodeInput(ctx)) : ""
      host
        .exec(config.run, stdin, timeout)
        .then((stdout) => {
          if (disposed) return
          const next = cleanOutput(stdout)
          if (next !== value) {
            value = next
            host.onValue()
          }
        })
        // A failing command leaves the previous value in place: a statusline that empties itself
        // because a script had a bad second is worse than one that is briefly stale.
        .catch(() => {})
        .finally(() => {
          running = false
        })
    },
    dispose() {
      disposed = true
    },
  }
}

/** The real shell, used outside tests. */
export async function execShell(command: string, stdin: string, timeoutMs: number): Promise<string> {
  const proc = Bun.spawn(["/bin/sh", "-c", command], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  try {
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) throw new Error(`exit ${code}`)
    return out
  } finally {
    clearTimeout(timer)
  }
}
