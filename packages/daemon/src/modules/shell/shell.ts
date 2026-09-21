import { createWriteStream, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type {
  LogLine,
  Owner,
  ScreenResult,
  ShellInfo,
  ShellStatus,
  StopReason,
} from "@opencode-cockpit/protocol/shell"
import { LineLog } from "./output/line-log.ts"
import { OutputNormalizer } from "./output/normalizer.ts"
import { RawRing } from "./output/raw-ring.ts"
import { Screen } from "./output/screen.ts"
import type { PtyBackend, PtyExit, PtyProcess } from "./pty.ts"
import type { WatchChange, Watcher } from "./watch/watcher.ts"

/** How much of the current run a newly attached watcher is shown: enough for a test summary. */
const WATCH_REPLAY_LINES = 500

const ERROR_LINE = /\b(error|err!|failed|failure|fatal|panic|exception|traceback)\b|✗|✖/i

export interface ShellSpec {
  id: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  title: string
  cols: number
  rows: number
  owner: Owner
  timeoutMs?: number
  idleTimeoutMs?: number
  /** Absolute path the clean log is appended to, when logging was requested. */
  logFile?: string
  /** Stop when the OpenCode window that started it goes away. */
  stopOnExit?: boolean
  /** Stop after this long with that window gone. */
  orphanAfterMs?: number
}

export interface ShellLimits {
  logChars: number
  rawBytes: number
  scrollback: number
}

export interface ShellListener {
  data?(offset: number, chunk: Uint8Array): void
  line?(line: LogLine): void
  /** The in-progress line changed (prompts that never end in a newline). */
  partial?(text: string): void
  exit?(info: ShellInfo): void
}

/**
 * One shell: a command, its PTY, and the three output views (ADR 0003).
 * Survives restarts: `run` increments and output views continue, separated by a marker line.
 */
export class Shell {
  readonly log: LineLog
  readonly raw: RawRing
  readonly screen: Screen
  status: ShellStatus = "running"
  run = 0
  /** First log line number belonging to the current run. */
  runStartLine = 1
  lastOutputAt = Date.now()
  /** Health rule attached to this shell, if any (see watch/watcher.ts). */
  watcher: Watcher | undefined
  /** Called when the watcher's reported status changes; never per line. */
  onWatchChange: ((change: WatchChange) => void) | undefined

  private pty: PtyProcess | undefined
  private normalizer: OutputNormalizer
  private listeners = new Set<ShellListener>()
  private startedAt = 0
  private endedAt: number | undefined
  private exit: PtyExit | undefined
  private error: string | undefined
  /** Why the daemon stopped it, when it was not a user or agent request. */
  private stoppedBecause: string | undefined
  private stopReason: StopReason | undefined
  private stoppedBy: string | undefined
  private summary: string | undefined
  private stopRequested = false
  private timeout: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setInterval> | undefined
  private logWriter: { write(text: string): void; end(): void } | undefined
  private exitPromise: Promise<void> = Promise.resolve()

  constructor(
    readonly spec: ShellSpec,
    private readonly backend: PtyBackend,
    limits: ShellLimits,
  ) {
    this.log = new LineLog(limits.logChars)
    this.raw = new RawRing(limits.rawBytes)
    this.screen = new Screen(spec.cols, spec.rows, limits.scrollback)
    this.normalizer = this.createNormalizer()
  }

  get id(): string {
    return this.spec.id
  }

  /** The line currently being written (e.g. a prompt awaiting input); empty when none. */
  get partialLine(): string {
    return this.normalizer.partial
  }

  get running(): boolean {
    return this.status === "running"
  }

  /** Resolves when the current run has fully exited and been accounted for. */
  get exited(): Promise<void> {
    return this.exitPromise
  }

  subscribe(listener: ShellListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.running && this.pty) throw new Error("shell is already running")
    this.run++
    if (this.run > 1) {
      this.normalizer.flush()
      this.log.append(`──── restart (run ${this.run}) ────`)
      this.screen.reset()
    }
    this.runStartLine = this.log.lastLine + 1
    this.stoppedBecause = undefined
    this.stopReason = undefined
    this.stoppedBy = undefined
    if (this.spec.logFile && !this.logWriter) {
      mkdirSync(dirname(this.spec.logFile), { recursive: true })
      const file = createWriteStream(this.spec.logFile, { flags: "a", mode: 0o600 })
      file.on("error", () => {
        this.logWriter = undefined
      })
      this.logWriter = { write: (text) => file.write(text), end: () => file.end() }
    }
    this.status = "running"
    this.startedAt = Date.now()
    this.lastOutputAt = this.startedAt
    this.endedAt = undefined
    this.exit = undefined
    this.error = undefined
    this.summary = undefined
    this.stopRequested = false

    try {
      this.pty = this.backend.spawn({
        command: this.spec.command,
        args: this.spec.args,
        cwd: this.spec.cwd,
        env: this.spec.env,
        cols: this.spec.cols,
        rows: this.spec.rows,
        onData: (chunk) => this.onData(chunk),
      })
    } catch (err) {
      this.pty = undefined
      this.status = "failed"
      this.error = err instanceof Error ? err.message : String(err)
      this.endedAt = Date.now()
      this.log.append(`[cockpit] failed to start: ${this.error}`)
      throw err
    }

    const pty = this.pty
    this.exitPromise = pty.exited.then((exit) => this.onExit(pty, exit))
    if (this.spec.timeoutMs) {
      this.timeout = setTimeout(() => {
        this.stoppedBecause = `reached its ${Math.round((this.spec.timeoutMs ?? 0) / 1000)}s time limit`
        this.stopReason = "timeout"
        void this.stop("SIGTERM", 3000)
      }, this.spec.timeoutMs)
    }
    if (this.spec.idleTimeoutMs) {
      const idleMs = this.spec.idleTimeoutMs
      this.idleTimer = setInterval(
        () => {
          if (!this.running || Date.now() - this.lastOutputAt < idleMs) return
          this.stoppedBecause = `produced no output for ${Math.round(idleMs / 1000)}s`
          this.stopReason = "idle"
          void this.stop("SIGTERM", 3000)
        },
        Math.max(500, Math.floor(idleMs / 4)),
      )
    }
  }

  write(data: string): number {
    if (!this.running || !this.pty) throw new Error(`shell is ${this.status}`)
    return this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    this.spec.cols = cols
    this.spec.rows = rows
    this.screen.resize(cols, rows)
    if (this.running) this.pty?.resize(cols, rows)
  }

  /**
   * Signal the group, escalate to SIGKILL after `graceMs`, and reap stragglers. `cause` says who
   * asked, so an exit can be reported as a stop rather than as an unexplained kill.
   */
  async stop(
    signal: NodeJS.Signals = "SIGTERM",
    graceMs = 3000,
    cause: { reason: StopReason; by?: string; because?: string } = { reason: "request" },
  ): Promise<void> {
    const pty = this.pty
    if (!pty || !this.running) return
    this.stopRequested = true
    this.stopReason ??= cause.reason
    this.stoppedBy ??= cause.by
    this.stoppedBecause ??= cause.because
    pty.signal(signal)
    const exited = await Promise.race([
      this.exitPromise.then(() => true),
      Bun.sleep(graceMs).then(() => false),
    ])
    if (!exited) {
      pty.signal("SIGKILL")
      await this.exitPromise
    }
    if (pty.groupAlive()) pty.signal("SIGKILL")
  }

  async snapshot(): Promise<ScreenResult> {
    return this.screen.snapshot()
  }

  info(): ShellInfo {
    const info: ShellInfo = {
      id: this.spec.id,
      title: this.spec.title,
      command: this.spec.command,
      args: this.spec.args,
      cwd: this.spec.cwd,
      owner: this.spec.owner,
      status: this.status,
      run: this.run,
      startedAt: this.startedAt,
      cols: this.spec.cols,
      rows: this.spec.rows,
      lines: { first: this.log.firstLine, last: this.log.lastLine },
      bytes: this.raw.end,
    }
    if (this.pty) info.pid = this.pty.pid
    if (this.exit?.exitCode != null) info.exitCode = this.exit.exitCode
    if (this.exit?.signal) info.signal = this.exit.signal
    if (this.error) info.error = this.error
    if (this.summary) info.summary = this.summary
    if (this.stopReason) info.stopReason = this.stopReason
    if (this.stoppedBy) info.stoppedBy = this.stoppedBy
    if (this.spec.logFile) info.logFile = this.spec.logFile
    if (this.watcher) info.watch = this.watcher.state()
    if (this.endedAt) info.endedAt = this.endedAt
    return info
  }

  dispose(): void {
    clearTimeout(this.timeout)
    clearInterval(this.idleTimer)
    this.logWriter?.end()
    this.listeners.clear()
    this.pty?.close()
    this.screen.dispose()
  }

  /**
   * Attach a health rule, and let it see what this run has already printed.
   *
   * A watcher only ever saw lines printed *after* it was attached, so a command that fails in its
   * first milliseconds — `echo FAILED` — could print its failure before `shell.watch` arrived, and
   * the run was judged without it. That is a real race for anyone who starts a shell and watches it
   * in a second call; it surfaced as a test that failed only on a busy machine, and blocked a
   * release. The current run's recent lines are replayed first — never an earlier run's, and at most
   * `WATCH_REPLAY_LINES`, so attaching to a long-running server stays cheap — then the exit, if the
   * run has already ended. Every change is reported exactly as it would have been live.
   */
  attachWatcher(watcher: Watcher, onChange: (change: WatchChange) => void): void {
    this.watcher = watcher
    this.onWatchChange = onChange
    const from = Math.max(this.runStartLine, this.log.firstLine, this.log.lastLine - WATCH_REPLAY_LINES + 1)
    for (let n = from; n <= this.log.lastLine; n++) {
      const text = this.log.get(n)
      if (text === undefined) continue
      const change = watcher.line(text)
      if (change) onChange(change)
    }
    if (this.status !== "running" && this.exit) {
      const ended = watcher.exited(this.exit.exitCode ?? undefined, this.exit.signal ?? undefined)
      if (ended) onChange(ended)
    }
  }

  /** Last error-looking line of the current run, else its last non-empty line. */
  private summarize(): string | undefined {
    const from = Math.max(this.runStartLine, this.log.lastLine - 200 + 1)
    let last: string | undefined
    for (let n = this.log.lastLine; n >= from; n--) {
      const text = this.log.get(n)?.trim()
      if (!text) continue
      last ??= text
      if (ERROR_LINE.test(text)) return text.slice(0, 300)
    }
    return last?.slice(0, 300)
  }

  private createNormalizer(): OutputNormalizer {
    return new OutputNormalizer((text) => {
      const line = this.log.append(text)
      this.logWriter?.write(`${text}\n`)
      const change = this.watcher?.line(text)
      if (change) this.onWatchChange?.(change)
      for (const l of this.listeners) l.line?.(line)
    })
  }

  private onData(chunk: Uint8Array): void {
    this.lastOutputAt = Date.now()
    const offset = this.raw.append(chunk)
    this.screen.write(chunk)
    this.normalizer.push(chunk)
    const partial = this.normalizer.partial
    for (const l of this.listeners) {
      l.data?.(offset, chunk)
      if (partial) l.partial?.(partial)
    }
  }

  private onExit(pty: PtyProcess, exit: PtyExit): void {
    if (this.pty !== pty) return // a newer run replaced this one
    clearTimeout(this.timeout)
    clearInterval(this.idleTimer)
    this.logWriter?.end()
    this.logWriter = undefined
    this.normalizer.flush()
    this.exit = exit
    this.endedAt = Date.now()
    this.status = this.stopRequested || exit.signal ? "killed" : "exited"
    this.summary = this.stoppedBecause ? `stopped: ${this.stoppedBecause}` : this.summarize()
    const ended = this.watcher?.exited(exit.exitCode ?? undefined, exit.signal ?? undefined)
    if (ended) this.onWatchChange?.(ended)
    // Session leader is gone; make sure nothing it left behind keeps running.
    if (pty.groupAlive()) pty.signal("SIGHUP")
    pty.close()
    const info = this.info()
    for (const l of this.listeners) l.exit?.(info)
  }
}
