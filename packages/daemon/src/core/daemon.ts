import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import {
  type CockpitPaths,
  daemonBuildId,
  ErrorCode,
  PROTOCOL_VERSION,
  RpcError,
} from "@opencode-cockpit/protocol"
import pkg from "../../package.json" with { type: "json" }
import { createLogger, type Level, type Logger } from "./logger.ts"
import type { Module } from "./module.ts"
import { Router } from "./router.ts"
import { RpcServer } from "./server.ts"

export interface DaemonOptions {
  paths: CockpitPaths
  modules: Module[]
  /** Shut down after this long with no clients and no busy module. 0 disables. */
  idleTimeoutMs?: number
  /** How often to re-check idleness and that the socket is still ours. */
  checkIntervalMs?: number
  logLevel?: Level
  /** Log to the log file (default) or stderr. */
  logToFile?: boolean
}

export const DAEMON_VERSION: string = pkg.version

/** Build id of this daemon's own code; computed once, matches what clients compute for the entry. */
// The directory this module was loaded from: `src/` in a checkout, `dist/` once published.
export const DAEMON_BUILD: string = daemonBuildId(
  Bun.fileURLToPath(new URL("..", import.meta.url)),
  DAEMON_VERSION,
)

/** A socket by identity rather than by name: the pair survives a rename and changes on a rebind. */
function socketIdentity(path: string): string | undefined {
  try {
    const stat = statSync(path)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return undefined
  }
}

export class Daemon {
  readonly log: Logger
  private readonly router = new Router()
  private readonly server: RpcServer
  private readonly startedAt = Date.now()
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private idleCheck: ReturnType<typeof setInterval> | undefined
  /** Which socket file this daemon is actually listening on, by identity rather than by path. */
  private socketId: string | undefined
  private stopping: Promise<void> | undefined
  private resolveStopped!: () => void
  /** Resolves once the daemon has fully shut down. */
  readonly stopped = new Promise<void>((resolve) => {
    this.resolveStopped = resolve
  })

  constructor(private readonly options: DaemonOptions) {
    this.log = createLogger(options.logToFile === false ? undefined : options.paths.logFile, options.logLevel)
    this.server = new RpcServer(
      this.router,
      {
        onConnect: () => this.refreshIdle(),
        onDisconnect: (_count, peer) => {
          // A window may keep working through its other half, so modules are told who is left.
          const remaining = this.server.instances
          for (const module of this.options.modules) module.peerClosed?.(peer, remaining)
          this.refreshIdle()
        },
      },
      this.log.child("rpc"),
    )
    this.registerCore()
    for (const module of options.modules) this.router.addModule(module)
  }

  async start(): Promise<void> {
    const { paths } = this.options
    mkdirSync(paths.home, { recursive: true, mode: 0o700 })
    chmodSync(paths.home, 0o700)
    await this.claimSocket(paths.socket)

    for (const module of this.options.modules) {
      await module.start({
        log: this.log.child(module.name),
        emit: (topic, data) => {
          this.server.broadcast(topic, data)
          // Module state changes (a shell exiting) can make the daemon idle.
          this.refreshIdle()
        },
        instances: () => this.server.instances,
      })
    }
    this.server.listen(paths.socket)
    chmodSync(paths.socket, 0o600)
    writeFileSync(paths.pidFile, String(process.pid), { mode: 0o600 })
    this.socketId = socketIdentity(paths.socket)
    this.idleCheck = setInterval(() => {
      this.refreshIdle()
      this.checkReachable()
    }, this.options.checkIntervalMs ?? 30_000)
    this.refreshIdle()
    this.log.info("daemon started", { pid: process.pid, build: DAEMON_BUILD, socket: paths.socket })
  }

  stop(reason = "requested"): Promise<void> {
    this.stopping ??= (async () => {
      this.log.info("daemon stopping", { reason })
      clearTimeout(this.idleTimer)
      clearInterval(this.idleCheck)
      this.server.stop()
      for (const module of [...this.options.modules].reverse()) {
        try {
          await module.stop()
        } catch (err) {
          this.log.error("module stop failed", { module: module.name, err: String(err) })
        }
      }
      const { paths } = this.options
      if (readPid(paths.pidFile) === process.pid) rmSync(paths.pidFile, { force: true })
      rmSync(paths.socket, { force: true })
      this.log.info("daemon stopped")
      this.resolveStopped()
    })()
    return this.stopping
  }

  /**
   * Stop once nobody can reach us any more.
   *
   * A unix socket is held by its inode, not by its name, so deleting the socket — or the whole home
   * directory, which is under `~/.cache` and exactly where cleanup tools aim — leaves this daemon
   * running and listening on a path that no longer exists. The next client finds no socket, starts a
   * second daemon, and this one keeps its shells alive where nothing can see or stop them: a dev
   * server holding a port, discoverable only with `ps`.
   *
   * There is no way back from it. A client can only connect through the path, and the path is gone or
   * belongs to somebody else now, so the honest thing is to shut down and let the shells go with us
   * rather than strand them for the rest of the session.
   */
  private checkReachable(): void {
    if (this.stopping || !this.socketId) return
    const now = socketIdentity(this.options.paths.socket)
    if (now === this.socketId) return
    this.log.warn("socket is no longer ours; nothing can reach this daemon", {
      socket: this.options.paths.socket,
      had: this.socketId,
      found: now ?? "gone",
    })
    void this.stop("unreachable")
  }

  private busy(): boolean {
    return this.options.modules.some((m) => m.busy())
  }

  private refreshIdle(): void {
    const timeout = this.options.idleTimeoutMs ?? 0
    if (timeout <= 0 || this.stopping) return
    const idle = this.server.clientCount === 0 && !this.busy()
    if (!idle) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    } else if (!this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        if (this.server.clientCount === 0 && !this.busy()) void this.stop("idle")
        else this.idleTimer = undefined
      }, timeout)
    }
  }

  /** Refuse to start if a live daemon owns the socket; otherwise clear a stale one. */
  private async claimSocket(socket: string): Promise<void> {
    if (!existsSync(socket)) return
    const alive = await new Promise<boolean>((resolve) => {
      Bun.connect({
        unix: socket,
        socket: {
          open(s) {
            s.end()
            resolve(true)
          },
          data() {},
          connectError: () => resolve(false),
          error: () => resolve(false),
        },
      }).catch(() => resolve(false))
    })
    if (alive) throw new Error(`another daemon is listening on ${socket}`)
    rmSync(socket, { force: true })
  }

  private registerCore(): void {
    this.router.add("daemon.hello", (raw, { peer }) => {
      const params = raw as { client: { name: string; instance?: string }; protocol: { major: number } }
      if (params.protocol.major !== PROTOCOL_VERSION.major) {
        throw new RpcError(ErrorCode.ProtocolMismatch, "protocol major version mismatch", {
          daemon: PROTOCOL_VERSION,
          client: params.protocol,
          busy: this.busy(),
        })
      }
      peer.greet(params.client.name, params.client.instance)
      return {
        daemonVersion: DAEMON_VERSION,
        build: DAEMON_BUILD,
        protocol: PROTOCOL_VERSION,
        modules: this.options.modules.map((m) => m.name),
        pid: process.pid,
        startedAt: this.startedAt,
      }
    })
    this.router.add("daemon.status", () => ({
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
      clients: this.server.clientCount,
      modules: this.options.modules.map((m) => ({ name: m.name, busy: m.busy() })),
    }))
    this.router.add("daemon.shutdown", (raw) => {
      const force = (raw as { force?: boolean } | undefined)?.force === true
      if (this.busy() && !force) return { accepted: false }
      setTimeout(() => void this.stop(force ? "forced shutdown" : "shutdown"), 10)
      return { accepted: true }
    })
    const topics =
      (on: boolean) =>
      (raw: unknown, { peer }: { peer: { topics: Set<string> } }) => {
        const list = (raw as { topics: string[] }).topics
        for (const t of list) on ? peer.topics.add(t) : peer.topics.delete(t)
        return { topics: [...peer.topics] }
      }
    this.router.add("events.subscribe", topics(true))
    this.router.add("events.unsubscribe", topics(false))
  }
}

function readPid(file: string): number | undefined {
  try {
    return Number.parseInt(readFileSync(file, "utf8"), 10)
  } catch {
    return undefined
  }
}
