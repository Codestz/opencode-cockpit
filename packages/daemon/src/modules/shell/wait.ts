import type { LogLine, WaitParams, WaitReason } from "@opencode-cockpit/protocol/shell"
import { probePort } from "./port-probe.ts"
import type { Shell } from "./shell.ts"

export interface WaitOutcome {
  reason: WaitReason
  match?: LogLine
}

export const PORT_POLL_MS = 250

/**
 * Races every condition in `until` plus the timeout. Exit always ends a wait: once the process is
 * gone no pattern, port or idle condition can still become true.
 */
export function waitFor(
  shell: Shell,
  params: WaitParams,
  compile: (p: string, i: boolean) => RegExp,
): Promise<WaitOutcome> {
  const { until, timeoutMs } = params

  return new Promise<WaitOutcome>((resolve) => {
    const cleanups: (() => void)[] = []
    let done = false
    const finish = (outcome: WaitOutcome) => {
      if (done) return
      done = true
      for (const cleanup of cleanups) cleanup()
      resolve(outcome)
    }

    const regex = until.pattern !== undefined ? compile(until.pattern, until.ignoreCase ?? false) : undefined

    // Lines already written count: "wait until ready" must succeed if it is ready already.
    if (regex) {
      const after = params.after ?? shell.runStartLine - 1
      const existing = shell.log.read({ after, tail: 0, limit: Number.MAX_SAFE_INTEGER, grep: regex })
      const first = existing.lines[0]
      if (first) return finish({ reason: "pattern", match: first })
    }
    if (!shell.running) return finish({ reason: "exit" })

    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const armIdle = () => {
      if (until.idleMs === undefined) return
      clearTimeout(idleTimer)
      const remaining = Math.max(0, until.idleMs - (Date.now() - shell.lastOutputAt))
      idleTimer = setTimeout(() => finish({ reason: "idle" }), remaining)
    }
    armIdle()
    cleanups.push(() => clearTimeout(idleTimer))

    cleanups.push(
      shell.subscribe({
        line(line) {
          if (regex?.test(line.text)) finish({ reason: "pattern", match: line })
        },
        partial(text) {
          if (regex?.test(text)) finish({ reason: "pattern", match: { n: shell.log.lastLine + 1, text } })
        },
        data: () => armIdle(),
        exit: () => finish({ reason: "exit" }),
      }),
    )

    if (until.port !== undefined) {
      const port = until.port
      const host = until.host ?? "127.0.0.1"
      let polling = true
      const poll = async () => {
        while (polling && !done) {
          if (await probePort(port, host)) return finish({ reason: "port" })
          await Bun.sleep(PORT_POLL_MS)
        }
      }
      void poll()
      cleanups.push(() => {
        polling = false
      })
    }

    const timer = setTimeout(() => finish({ reason: "timeout" }), timeoutMs)
    cleanups.push(() => clearTimeout(timer))
  })
}
