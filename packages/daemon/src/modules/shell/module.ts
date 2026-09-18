import { join } from "node:path"
import type { ShellInfo, StartParams } from "@opencode-cockpit/protocol/shell"
import { invalidParams, notFound } from "../../core/errors.ts"
import type { Logger } from "../../core/logger.ts"
import { silentLogger } from "../../core/logger.ts"
import type { MethodTable, Module, ModuleContext, Peer } from "../../core/module.ts"
import { newShellId } from "./ids.ts"
import { shellMethods } from "./methods.ts"
import { bunPtyBackend, type PtyBackend } from "./pty.ts"
import { ProcessRegistry } from "./registry.ts"
import { Shell, type ShellLimits } from "./shell.ts"

export interface ShellModuleOptions {
  backend?: PtyBackend
  limits?: Partial<ShellLimits>
  /** Oldest finished shells are forgotten beyond this many. */
  maxFinished?: number
  /** Base environment for spawned processes (defaults to the daemon's). */
  baseEnv?: Record<string, string | undefined>
  /** Coalesce output events per attached peer for this long. */
  outputFlushMs?: number
  /** Where to record owned process groups so a restarted daemon can reap orphans. */
  registryFile?: string
  /** Directory for per-shell log files, when a caller asks for one. */
  logDir?: string
  /** How often to look for shells whose window is gone for good. */
  orphanSweepMs?: number
}

const DEFAULT_LIMITS: ShellLimits = { logChars: 4_000_000, rawBytes: 1_000_000, scrollback: 2000 }

export class ShellModule implements Module<"shell"> {
  readonly name = "shell" as const
  /** @internal */
  readonly shells = new Map<string, Shell>()
  /** @internal */
  readonly attachments = new Map<string, () => void>() // `${peer.id}:${shellId}` → detach
  private readonly backend: PtyBackend
  private readonly limits: ShellLimits
  private log: Logger = silentLogger
  /** When each absent window was last seen, for the orphan sweep. */
  private readonly goneSince = new Map<string, number>()
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private connected: () => Set<string> = () => new Set()
  private registry: ProcessRegistry | undefined
  private readonly idleTimers = new Map<string, ReturnType<typeof setInterval>>()
  /** @internal */
  emit: ModuleContext["emit"] = () => {}

  constructor(private readonly options: ShellModuleOptions = {}) {
    this.backend = options.backend ?? bunPtyBackend
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.log = ctx.log
    this.emit = ctx.emit
    this.connected = ctx.instances
    // A shell whose window never comes back should not outlive the day. Checked rarely: the
    // decision is a timestamp comparison, and only shells that asked for it are considered.
    this.sweepTimer = setInterval(() => this.sweepOrphans(), this.options.orphanSweepMs ?? 60_000)
    if (this.options.registryFile) {
      this.registry = new ProcessRegistry(this.options.registryFile, ctx.log)
      const reaped = this.registry.reap()
      if (reaped > 0) ctx.log.warn("cleaned up shells left by a previous daemon", { reaped })
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.sweepTimer)
    for (const id of [...this.idleTimers.keys()]) this.clearIdle(id)
    await Promise.all(
      [...this.shells.values()].map((s) => s.stop("SIGTERM", 2000, { reason: "shutdown" }).catch(() => {})),
    )
    for (const detach of this.attachments.values()) detach()
    for (const shell of this.shells.values()) shell.dispose()
    this.attachments.clear()
    this.shells.clear()
  }

  /**
   * An OpenCode window disconnected. Both halves of a plugin share an instance id, so this only
   * counts as "the window is gone" once neither half is connected any more.
   */
  peerClosed(peer: { instance?: string }, remaining: Set<string>): void {
    const instance = peer.instance
    if (!instance || remaining.has(instance)) return
    this.goneSince.set(instance, Date.now())
    for (const shell of this.shells.values()) {
      if (!shell.spec.stopOnExit || shell.spec.owner.instance !== instance || !shell.running) continue
      this.log.info("stopping shell with its window", { id: shell.id, instance })
      void shell
        .stop("SIGTERM", 2000, {
          reason: "shutdown",
          because: "the OpenCode window that started it closed",
        })
        .catch(() => {})
    }
  }

  /** Shells whose window has been gone longer than they allow. */
  private sweepOrphans(): void {
    const live = this.connected()
    for (const instance of [...this.goneSince.keys()]) if (live.has(instance)) this.goneSince.delete(instance)

    const now = Date.now()
    for (const shell of this.shells.values()) {
      const limit = shell.spec.orphanAfterMs
      const instance = shell.spec.owner.instance
      if (!limit || !instance || !shell.running || live.has(instance)) continue
      const gone = this.goneSince.get(instance) ?? now
      this.goneSince.set(instance, gone)
      if (now - gone < limit) continue
      this.log.info("stopping orphaned shell", { id: shell.id, instance, afterMs: now - gone })
      void shell
        .stop("SIGTERM", 2000, {
          reason: "shutdown",
          because: `nothing watched it for ${Math.round((now - gone) / 60_000)} minutes`,
        })
        .catch(() => {})
    }
  }

  busy(): boolean {
    for (const shell of this.shells.values()) if (shell.running) return true
    return false
  }

  readonly methods: MethodTable<"shell"> = shellMethods(this)

  /** @internal used by methods.ts */
  startShell(params: StartParams): ShellInfo {
    if (params.reuse) {
      const previous = this.findReusable(params)
      if (previous) {
        Object.assign(previous.spec, {
          env: this.environment(params.env),
          title: params.title ?? previous.spec.title,
          timeoutMs: params.timeoutMs,
          owner: params.owner,
          stopOnExit: params.stopOnExit,
          orphanAfterMs: params.orphanAfterMs,
        })
        this.spawn(previous)
        return previous.info()
      }
    }
    const id = this.uniqueId()
    const shell = new Shell(
      {
        id,
        command: params.command,
        args: params.args,
        cwd: params.cwd,
        env: this.environment(params.env),
        title: params.title ?? [params.command, ...params.args].join(" ").slice(0, 200),
        cols: params.cols,
        rows: params.rows,
        owner: params.owner,
        timeoutMs: params.timeoutMs,
        idleTimeoutMs: params.idleTimeoutMs,
        logFile: params.logFile ? join(this.options.logDir ?? "/tmp", `${id}.log`) : undefined,
        stopOnExit: params.stopOnExit,
        orphanAfterMs: params.orphanAfterMs,
      },
      this.backend,
      this.limits,
    )
    this.shells.set(shell.id, shell)
    shell.subscribe({ exit: (info) => this.onExit(info) })
    this.spawn(shell)
    this.pruneFinished()
    return shell.info()
  }

  /** @internal used by methods.ts */
  findReusable(params: StartParams): Shell | undefined {
    const args = JSON.stringify(params.args)
    let match: Shell | undefined
    for (const shell of this.shells.values()) {
      const spec = shell.spec
      if (
        !shell.running &&
        spec.command === params.command &&
        JSON.stringify(spec.args) === args &&
        spec.cwd === params.cwd &&
        spec.owner.project === params.owner.project &&
        spec.owner.session === params.owner.session &&
        (!match || shell.info().startedAt > match.info().startedAt)
      ) {
        match = shell
      }
    }
    return match
  }

  /** @internal used by methods.ts */
  spawn(shell: Shell): void {
    try {
      shell.start()
    } catch (err) {
      const info = shell.info()
      this.log.warn("spawn failed", { id: shell.id, command: shell.spec.command, err: String(err) })
      this.emit("shell.exited", info)
      return
    }
    const pid = shell.info().pid
    if (pid) this.registry?.add(shell.id, pid, shell.spec.command)
    this.log.info("shell started", { id: shell.id, command: shell.spec.command, pid })
    this.emit("shell.started", shell.info())
  }

  private onExit(info: ShellInfo): void {
    this.registry?.remove(info.id)
    this.log.info("shell ended", {
      id: info.id,
      status: info.status,
      exitCode: info.exitCode,
      signal: info.signal,
    })
    this.emit("shell.exited", info)
  }

  /** @internal used by methods.ts */
  attachStream(peer: Peer, shell: Shell): void {
    const key = `${peer.id}:${shell.id}`
    const flushMs = this.options.outputFlushMs ?? 16
    let pending: Uint8Array[] = []
    let pendingOffset = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      timer = undefined
      if (pending.length === 0) return
      const data = Buffer.concat(pending).toString("base64")
      peer.send("shell.output", { id: shell.id, offset: pendingOffset, data })
      pending = []
    }
    const unsubscribe = shell.subscribe({
      data(offset, chunk) {
        if (pending.length === 0) pendingOffset = offset
        pending.push(chunk)
        timer ??= setTimeout(flush, flushMs)
      },
    })
    const detach = () => {
      clearTimeout(timer)
      flush()
      unsubscribe()
      this.attachments.delete(key)
    }
    this.attachments.set(key, detach)
    peer.onClose(detach)
  }

  /** @internal used by methods.ts */
  detach(peer: Peer, id: string): void {
    this.attachments.get(`${peer.id}:${id}`)?.()
  }

  /**
   * Rules without a `done` pattern end a run on silence, so poll those watchers; the check is a
   * timestamp comparison, and only shells that need it are polled.
   */
  /** @internal used by methods.ts */
  armIdle(shell: Shell): void {
    this.clearIdle(shell.id)
    const idleMs = shell.watcher?.idleMs
    if (!idleMs) return
    const timer = setInterval(
      () => {
        if (!shell.watcher || Date.now() - shell.lastOutputAt < idleMs) return
        const change = shell.watcher.idle()
        if (change) this.emit("shell.watch", { info: shell.info(), ...change })
      },
      Math.max(500, Math.floor(idleMs / 2)),
    )
    this.idleTimers.set(shell.id, timer)
  }

  /** @internal used by methods.ts */
  clearIdle(id: string): void {
    const timer = this.idleTimers.get(id)
    if (timer) clearInterval(timer)
    this.idleTimers.delete(id)
  }

  /** @internal used by methods.ts */
  forget(shell: Shell): void {
    this.clearIdle(shell.id)
    for (const [key, detach] of this.attachments) if (key.endsWith(`:${shell.id}`)) detach()
    shell.dispose()
    this.shells.delete(shell.id)
    this.emit("shell.removed", { id: shell.id })
  }

  /** @internal used by methods.ts */
  pruneFinished(): void {
    const max = this.options.maxFinished ?? 50
    const finished = [...this.shells.values()].filter((s) => !s.running)
    for (const shell of finished.slice(0, Math.max(0, finished.length - max))) this.forget(shell)
  }

  /** @internal used by methods.ts */
  require(id: string): Shell {
    const shell = this.shells.get(id)
    if (!shell) throw notFound(`shell ${id}`)
    return shell
  }

  /** @internal used by methods.ts */
  uniqueId(): string {
    let id = newShellId()
    while (this.shells.has(id)) id = newShellId()
    return id
  }

  /** @internal used by methods.ts */
  environment(extra: Record<string, string> | undefined): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.options.baseEnv ?? process.env)) if (v !== undefined) env[k] = v
    env.TERM ??= "xterm-256color"
    env.COLORTERM ??= "truecolor"
    Object.assign(env, extra)
    return env
  }
}

export function compilePattern(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? "i" : "")
  } catch (err) {
    throw invalidParams(`invalid pattern: ${err instanceof Error ? err.message : String(err)}`)
  }
}
