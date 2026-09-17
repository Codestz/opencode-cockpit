import { readFileSync, renameSync, writeFileSync } from "node:fs"
import type { Logger } from "../../core/logger.ts"

interface Entry {
  id: string
  pid: number
  /** `ps -o lstart` of the pid when registered; guards against pid reuse. */
  started: string
  command: string
}

/**
 * On-disk record of process groups the daemon owns. If the daemon dies without stopping its
 * shells, the next daemon kills whatever is still alive from that list.
 */
export class ProcessRegistry {
  private entries = new Map<string, Entry>()

  constructor(
    private readonly file: string,
    private readonly log: Logger,
  ) {}

  /** Kill leftovers from a previous daemon. Returns how many process groups were reaped. */
  reap(): number {
    let previous: Entry[] = []
    try {
      previous = JSON.parse(readFileSync(this.file, "utf8")) as Entry[]
    } catch {
      // no registry yet, or unreadable: nothing to reap
    }
    let reaped = 0
    for (const entry of previous) {
      const started = processStartTime(entry.pid)
      if (!started || started !== entry.started) continue // gone, or the pid now belongs to someone else
      signalGroup(entry.pid, "SIGKILL")
      reaped++
      this.log.warn("reaped orphaned shell", { id: entry.id, pid: entry.pid, command: entry.command })
    }
    this.entries.clear()
    this.flush()
    return reaped
  }

  add(id: string, pid: number, command: string): void {
    const started = processStartTime(pid)
    if (!started) return
    this.entries.set(id, { id, pid, started, command })
    this.flush()
  }

  remove(id: string): void {
    if (this.entries.delete(id)) this.flush()
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify([...this.entries.values()]), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (err) {
      this.log.warn("could not write process registry", { err: String(err) })
    }
  }
}

export function processStartTime(pid: number): string | undefined {
  const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = result.stdout.toString().trim()
  return result.exitCode === 0 && text ? text : undefined
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}
