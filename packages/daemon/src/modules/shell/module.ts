import { join } from "node:path"
import type { ShellInfo, StartParams } from "@opencode-cockpit/protocol/shell"
import { invalidParams, invalidState, notFound } from "../../core/errors.ts"
import type { Logger } from "../../core/logger.ts"
import { silentLogger } from "../../core/logger.ts"
import type { MethodTable, Module, ModuleContext, Peer } from "../../core/module.ts"
import { newShellId } from "./ids.ts"
import { bunPtyBackend, type PtyBackend } from "./pty.ts"
import { ProcessRegistry } from "./registry.ts"
import { Shell, type ShellLimits } from "./shell.ts"
import { waitFor } from "./wait.ts"
import { PRESETS, presetByName, presetForCommand } from "./watch/presets.ts"
import { compileRule, Watcher } from "./watch/watcher.ts"

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
}

const DEFAULT_LIMITS: ShellLimits = { logChars: 4_000_000, rawBytes: 1_000_000, scrollback: 2000 }

export class ShellModule implements Module<"shell"> {
  readonly name = "shell" as const
  private readonly shells = new Map<string, Shell>()
  private readonly attachments = new Map<string, () => void>() // `${peer.id}:${shellId}` → detach
  private readonly backend: PtyBackend
  private readonly limits: ShellLimits
  private log: Logger = silentLogger
  private registry: ProcessRegistry | undefined
  private readonly idleTimers = new Map<string, ReturnType<typeof setInterval>>()
  private emit: ModuleContext["emit"] = () => {}

  constructor(private readonly options: ShellModuleOptions = {}) {
    this.backend = options.backend ?? bunPtyBackend
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.log = ctx.log
    this.emit = ctx.emit
    if (this.options.registryFile) {
      this.registry = new ProcessRegistry(this.options.registryFile, ctx.log)
      const reaped = this.registry.reap()
      if (reaped > 0) ctx.log.warn("cleaned up shells left by a previous daemon", { reaped })
    }
  }

  async stop(): Promise<void> {
    for (const id of [...this.idleTimers.keys()]) this.clearIdle(id)
    await Promise.all([...this.shells.values()].map((s) => s.stop("SIGTERM", 2000).catch(() => {})))
    for (const detach of this.attachments.values()) detach()
    for (const shell of this.shells.values()) shell.dispose()
    this.attachments.clear()
    this.shells.clear()
  }

  busy(): boolean {
    for (const shell of this.shells.values()) if (shell.running) return true
    return false
  }

  readonly methods: MethodTable<"shell"> = {
    start: (params) => this.startShell(params),

    list: (params) => {
      const owner = params.owner
      return [...this.shells.values()]
        .filter((s) => params.includeExited || s.running)
        .filter((s) => !owner?.project || s.spec.owner.project === owner.project)
        .filter((s) => !owner?.session || s.spec.owner.session === owner.session)
        .map((s) => s.info())
    },

    get: ({ id }) => this.require(id).info(),

    read: ({ id, after, tail, limit, grep, ignoreCase }) => {
      const shell = this.require(id)
      const page = shell.log.read({
        after,
        tail,
        limit,
        grep: grep === undefined ? undefined : compilePattern(grep, ignoreCase),
      })
      return { ...page, status: shell.status }
    },

    screen: ({ id }) => this.require(id).snapshot(),

    write: ({ id, data }) => {
      const shell = this.require(id)
      if (!shell.running) throw invalidState(`shell ${id} is ${shell.status}`)
      return { bytes: shell.write(data) }
    },

    resize: ({ id, cols, rows }) => {
      this.require(id).resize(cols, rows)
      return {}
    },

    wait: async (params) => {
      const shell = this.require(params.id)
      const outcome = await waitFor(shell, params, compilePattern)
      return { ...outcome, info: shell.info() }
    },

    stop: async ({ id, signal, graceMs }) => {
      const shell = this.require(id)
      await shell.stop(signal, graceMs)
      await shell.exited
      return shell.info()
    },

    restart: async ({ id }) => {
      const shell = this.require(id)
      if (shell.running) {
        await shell.stop("SIGTERM", 3000)
        await shell.exited
      }
      this.spawn(shell)
      return shell.info()
    },

    remove: async ({ id }) => {
      const shell = this.require(id)
      if (shell.running) {
        await shell.stop("SIGTERM", 3000)
        await shell.exited
      }
      this.forget(shell)
      return {}
    },

    attach: ({ id, fromOffset }, { peer }) => {
      const shell = this.require(id)
      this.detach(peer, id)
      const replay = shell.raw.since(fromOffset ?? 0)
      this.attachStream(peer, shell)
      return { offset: replay.offset, replay: Buffer.from(replay.bytes).toString("base64") }
    },

    clear: ({ owner, finishedBeforeMs }) => {
      const cutoff = Date.now() - (finishedBeforeMs ?? 0)
      const removed: string[] = []
      for (const shell of [...this.shells.values()]) {
        if (shell.running) continue
        const info = shell.info()
        if (owner?.project && info.owner.project !== owner.project) continue
        if (owner?.session && info.owner.session !== owner.session) continue
        if ((info.endedAt ?? 0) > cutoff) continue
        this.forget(shell)
        removed.push(info.id)
      }
      return { removed }
    },

    watch: ({ id, preset, rule }) => {
      const shell = this.require(id)
      const command = [shell.spec.command, ...shell.spec.args].join(" ")
      const chosen = rule
        ? undefined
        : preset && preset !== "auto"
          ? (presetByName(preset) ??
            invalidParams(`unknown preset "${preset}"; call shell.presets for the list`))
          : presetForCommand(command)
      if (chosen instanceof Error) throw chosen
      const watchRule = rule ?? chosen?.rule
      if (!watchRule) {
        throw invalidParams(
          `no watch preset matches "${command.slice(0, 80)}"; pass a rule (done/fail/ok patterns) or a preset name`,
        )
      }
      try {
        shell.watcher = new Watcher(compileRule(watchRule), chosen?.name)
      } catch (err) {
        throw invalidParams(`invalid watch pattern: ${err instanceof Error ? err.message : String(err)}`)
      }
      shell.onWatchChange = (change) => {
        this.emit("shell.watch", { info: shell.info(), ...change })
      }
      this.armIdle(shell)
      return shell.info()
    },

    unwatch: ({ id }) => {
      const shell = this.require(id)
      shell.watcher = undefined
      shell.onWatchChange = undefined
      this.clearIdle(id)
      return shell.info()
    },

    presets: () => PRESETS.map((preset) => ({ name: preset.name, match: preset.match, rule: preset.rule })),

    detach: ({ id }, { peer }) => {
      this.detach(peer, id)
      return {}
    },
  }

  private startShell(params: StartParams): ShellInfo {
    if (params.reuse) {
      const previous = this.findReusable(params)
      if (previous) {
        Object.assign(previous.spec, {
          env: this.environment(params.env),
          title: params.title ?? previous.spec.title,
          timeoutMs: params.timeoutMs,
          owner: params.owner,
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

  private findReusable(params: StartParams): Shell | undefined {
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

  private spawn(shell: Shell): void {
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

  private attachStream(peer: Peer, shell: Shell): void {
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

  private detach(peer: Peer, id: string): void {
    this.attachments.get(`${peer.id}:${id}`)?.()
  }

  /**
   * Rules without a `done` pattern end a run on silence, so poll those watchers; the check is a
   * timestamp comparison, and only shells that need it are polled.
   */
  private armIdle(shell: Shell): void {
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

  private clearIdle(id: string): void {
    const timer = this.idleTimers.get(id)
    if (timer) clearInterval(timer)
    this.idleTimers.delete(id)
  }

  private forget(shell: Shell): void {
    this.clearIdle(shell.id)
    for (const [key, detach] of this.attachments) if (key.endsWith(`:${shell.id}`)) detach()
    shell.dispose()
    this.shells.delete(shell.id)
    this.emit("shell.removed", { id: shell.id })
  }

  private pruneFinished(): void {
    const max = this.options.maxFinished ?? 50
    const finished = [...this.shells.values()].filter((s) => !s.running)
    for (const shell of finished.slice(0, Math.max(0, finished.length - max))) this.forget(shell)
  }

  private require(id: string): Shell {
    const shell = this.shells.get(id)
    if (!shell) throw notFound(`shell ${id}`)
    return shell
  }

  private uniqueId(): string {
    let id = newShellId()
    while (this.shells.has(id)) id = newShellId()
    return id
  }

  private environment(extra: Record<string, string> | undefined): Record<string, string> {
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
