import type { CommandConfig } from "./config.ts"
import { contextUsed, type StatusContext } from "./context.ts"

/**
 * The escape hatch: a shell command whose stdout becomes a segment.
 *
 * It is fed the same JSON on stdin that Claude Code's statusLine hook sends, so a statusline
 * script someone already wrote works here unchanged. That matters more than elegance — nobody
 * rewrites a working statusline to try a new editor.
 *
 * Unlike Claude Code's, this is not on the draw path: the command runs on its own interval and the
 * line renders whatever it last returned, so a slow script makes the value stale rather than making
 * the interface stutter.
 */

/** Claude Code's statusLine stdin payload, as close as our data allows. */
export interface ClaudeCodeStatusInput {
  hook_event_name: "Status"
  session_id: string
  cwd: string
  model: { id: string; display_name: string }
  workspace: { current_dir: string; project_dir: string }
  version: string
  output_style: { name: string }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  exceeds_200k_tokens: boolean
}

export function claudeCodeInput(ctx: StatusContext): ClaudeCodeStatusInput {
  const session = ctx.session
  const model = session?.model
  return {
    hook_event_name: "Status",
    session_id: session?.id ?? "",
    cwd: ctx.directory,
    model: {
      id: model?.modelID ?? "",
      display_name: model?.modelID ?? "",
    },
    workspace: { current_dir: ctx.directory, project_dir: ctx.worktree },
    version: ctx.version,
    output_style: { name: "default" },
    cost: {
      total_cost_usd: session?.cost ?? 0,
      total_duration_ms: session?.startedAt ? Math.max(0, ctx.now - session.startedAt) : 0,
      total_lines_added: session?.diff.additions ?? 0,
      total_lines_removed: session?.diff.deletions ?? 0,
    },
    exceeds_200k_tokens: contextUsed(session?.tokens) > 200_000,
  }
}

// Control sequences a script emits for colour. The line is drawn by OpenTUI, which paints from
// theme tones rather than raw escapes, so they are removed instead of printed as gibberish.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

export function cleanOutput(stdout: string): string {
  const [first = ""] = stdout.replace(ANSI, "").split("\n")
  return first.trim()
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
