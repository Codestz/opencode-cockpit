import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { type Accessor, createMemo, createRoot, createSignal } from "solid-js"
import { type CommandRunner, createRunner, execShell } from "../../core/command.ts"
import { resolveLines, type StatusConfig } from "../../core/config.ts"
import type { StatusContext } from "../../core/context.ts"
import { type DiffCounts, parseShortstat, UNCOMMITTED, wantsDiff } from "../../core/diff.ts"

/**
 * Keeps one snapshot of OpenCode's state for every line to read. One memo rather than one per
 * segment: the whole snapshot is a handful of reads of state already in memory, and recomputing it
 * once a second costs less than the bookkeeping to avoid it.
 */

export interface StatusStore {
  context: Accessor<StatusContext>
  dispose(): void
}

export interface StoreOptions {
  version: string
  /** How often the line recomputes. */
  tickMs?: number
  /** How often the working tree is measured. */
  diffIntervalMs?: number
  /** Injected in tests, so no shell runs and no clock is needed. */
  exec?: (command: string, stdin: string, timeoutMs: number) => Promise<string>
  now?: () => number
  build: (
    api: TuiPluginApi,
    input: {
      now: number
      width: number
      version: string
      commands: Record<string, string>
      diff: DiffCounts | undefined
    },
  ) => StatusContext
}

export function createStatusStore(
  api: TuiPluginApi,
  config: StatusConfig,
  options: StoreOptions,
): StatusStore {
  return createRoot((dispose) => {
    const clock = options.now ?? (() => Date.now())
    const [now, setNow] = createSignal(clock())
    const tick = setInterval(() => setNow(clock()), options.tickMs ?? 1000)

    // A finished command run is a repaint: `equals: false` so an identical count still notifies.
    const [commandTick, bump] = createSignal(0, { equals: false })
    const runners = new Map<string, CommandRunner>()
    for (const [name, command] of Object.entries(config.commands ?? {})) {
      runners.set(
        name,
        createRunner(command, {
          exec: options.exec ?? execShell,
          now: clock,
          onValue: () => bump((n) => n + 1),
        }),
      )
    }

    /**
     * The working tree's own numbers.
     *
     * Its own runner rather than a special case: the scheduling, the caching and the "only while the
     * line is drawn" behaviour are already right here, and a git call is exactly the kind of thing
     * they were built for. `claudeCodeCompat` is off because nothing is being handed a session on
     * stdin — this is one command with one answer.
     */
    const diffRunner = wantsDiff(resolveLines(config))
      ? createRunner(
          {
            run: UNCOMMITTED,
            intervalMs: options.diffIntervalMs ?? 2000,
            timeoutMs: 1500,
            claudeCodeCompat: false,
          },
          { exec: options.exec ?? execShell, now: clock, onValue: () => bump((n) => n + 1) },
        )
      : undefined

    const context = createMemo(() => {
      commandTick()
      const commands: Record<string, string> = {}
      for (const [name, runner] of runners) commands[name] = runner.value()
      const ctx = options.build(api, {
        now: now(),
        width: api.renderer.width,
        version: options.version,
        commands,
        diff: diffRunner ? parseShortstat(diffRunner.value()) : undefined,
      })
      // Asking here keeps the schedule tied to what is actually drawn: a hidden line costs nothing.
      for (const runner of runners.values()) runner.maybeRun(ctx)
      diffRunner?.maybeRun(ctx)
      return ctx
    })

    return {
      context,
      dispose() {
        clearInterval(tick)
        for (const runner of runners.values()) runner.dispose()
        dispose()
      },
    }
  })
}
