/**
 * PTY backend seam. The shell module depends only on these interfaces so the process layer can be
 * swapped (Windows ConPTY, remote hosts, test fakes) without touching session logic.
 */

export interface PtySpawnOptions {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  onData: (chunk: Uint8Array) => void
}

export interface PtyExit {
  exitCode: number | null
  signal: string | null
}

export interface PtyProcess {
  readonly pid: number
  readonly exited: Promise<PtyExit>
  write(data: string | Uint8Array): number
  resize(cols: number, rows: number): void
  /** Signal the whole process group; falls back to the leader. */
  signal(signal: NodeJS.Signals): void
  /** True while any member of the process group is alive. */
  groupAlive(): boolean
  close(): void
}

export interface PtyBackend {
  spawn(options: PtySpawnOptions): PtyProcess
}

interface BunTerminal {
  write(data: string | Uint8Array): number
  resize(cols: number, rows: number): void
  close(): void
}

/** Native PTY via `Bun.spawn({ terminal })` (Bun ≥ 1.3.5). The child leads its own session and group. */
export const bunPtyBackend: PtyBackend = {
  spawn(options) {
    const proc = Bun.spawn([options.command, ...options.args], {
      cwd: options.cwd,
      env: options.env,
      terminal: {
        cols: options.cols,
        rows: options.rows,
        data(_terminal: unknown, chunk: Uint8Array) {
          // Bun reuses the buffer between callbacks.
          options.onData(chunk.slice())
        },
      },
    } as Parameters<typeof Bun.spawn>[1]) as ReturnType<typeof Bun.spawn> & { terminal: BunTerminal }

    const pid = proc.pid
    const exited = proc.exited.then(() => ({
      exitCode: proc.signalCode ? null : proc.exitCode,
      signal: proc.signalCode ?? null,
    }))

    return {
      pid,
      exited,
      write: (data) => proc.terminal.write(data),
      resize: (cols, rows) => proc.terminal.resize(cols, rows),
      signal(signal) {
        try {
          process.kill(-pid, signal)
        } catch {
          try {
            process.kill(pid, signal)
          } catch {
            // already gone
          }
        }
      },
      groupAlive() {
        try {
          process.kill(-pid, 0)
          return true
        } catch {
          return false
        }
      },
      close() {
        try {
          proc.terminal.close()
        } catch {
          // already closed
        }
      },
    }
  },
}
