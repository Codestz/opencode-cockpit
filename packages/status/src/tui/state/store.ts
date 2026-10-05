import type { Host } from "@opencode-cockpit/client/host"
import { type Accessor, createMemo, createRoot, createSignal } from "solid-js"
import { BUDGET_EVERY_MS, type Budget, budgetFile } from "../../core/budget.ts"
import { type CommandRunner, createRunner } from "../../core/command.ts"
import { resolveLines, type StatusConfig } from "../../core/config.ts"
import type { StatusContext } from "../../core/context.ts"
import {
  branchDiffCommand,
  type DiffCounts,
  parseShortstat,
  UNCOMMITTED,
  wantsBranchDiff,
  wantsDiff,
} from "../../core/diff.ts"
import { readBudget } from "../../io/budget.ts"
import { execShell } from "../../io/command.ts"

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
  /** Injected in tests, so no file is read. */
  readBudget?: (path: string) => Budget | undefined
  now?: () => number
  build: (
    api: Host,
    input: {
      now: number
      width: number
      version: string
      commands: Record<string, string>
      diff: DiffCounts | undefined
      branchDiff: DiffCounts | undefined
      budget: Budget | undefined
    },
  ) => StatusContext
}

export function createStatusStore(api: Host, config: StatusConfig, options: StoreOptions): StatusStore {
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
    const lines = resolveLines(config)
    const diffRunner = wantsDiff(lines)
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

    /**
     * The branch's whole diff, for `git`. The command names the default branch, which OpenCode may
     * only learn after the first frame, so the runner is made once it is known — and made again if
     * it changes. Until then `main`, the likeliest answer.
     */
    const branchWanted = wantsBranchDiff(lines)
    let branch: { base: string; runner: CommandRunner } | undefined
    const branchRunner = (base: string) => {
      if (branch?.base === base) return branch.runner
      branch?.runner.dispose()
      const runner = createRunner(
        { run: branchDiffCommand(base), intervalMs: 10_000, timeoutMs: 3000, claudeCodeCompat: false },
        { exec: options.exec ?? execShell, now: clock, onValue: () => bump((n) => n + 1) },
      )
      branch = { base, runner }
      return runner
    }

    /** A proxy's budget, for `spend` and `avail`: a tiny file, read again every few seconds. */
    const budgetPath = budgetFile(lines)
    let budget: Budget | undefined
    let budgetAt = Number.NEGATIVE_INFINITY

    const context = createMemo(() => {
      commandTick()
      const at = now()
      const commands: Record<string, string> = {}
      for (const [name, runner] of runners) commands[name] = runner.value()
      if (budgetPath && at - budgetAt >= BUDGET_EVERY_MS) {
        budgetAt = at
        budget = (options.readBudget ?? readBudget)(budgetPath)
      }
      const ctx = options.build(api, {
        now: at,
        width: api.renderer.width,
        version: options.version,
        commands,
        diff: diffRunner ? parseShortstat(diffRunner.value()) : undefined,
        branchDiff: branch ? parseShortstat(branch.runner.value()) : undefined,
        budget,
      })
      // Asking here keeps the schedule tied to what is actually drawn: a hidden line costs nothing.
      for (const runner of runners.values()) runner.maybeRun(ctx)
      diffRunner?.maybeRun(ctx)
      if (branchWanted) branchRunner(ctx.defaultBranch ?? "main").maybeRun(ctx)
      return ctx
    })

    return {
      context,
      dispose() {
        clearInterval(tick)
        for (const runner of runners.values()) runner.dispose()
        branch?.runner.dispose()
        dispose()
      },
    }
  })
}
