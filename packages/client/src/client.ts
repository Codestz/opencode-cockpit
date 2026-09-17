import { existsSync } from "node:fs"
import {
  type ClientInfo,
  type CockpitPaths,
  ErrorCode,
  type EventEnvelope,
  type EventOf,
  type Events,
  type HelloResult,
  type MethodName,
  type Methods,
  type ParamsOf,
  PROTOCOL_VERSION,
  type ResultOf,
  RpcError,
  resolvePaths,
  type Topic,
} from "@opencode-cockpit/protocol"
import { Connection } from "./connection.ts"
import { releaseSpawnLock, type SpawnOptions, spawnDaemon } from "./spawn.ts"

export interface ClientOptions {
  client: ClientInfo
  paths?: CockpitPaths
  /** Start the daemon when it is not running. Omit to only connect. */
  spawn?: SpawnOptions
  /** How long to wait for a freshly spawned daemon. */
  connectTimeoutMs?: number
  /**
   * Build id of the daemon code this client ships with (see `daemonBuildId`). When the running
   * daemon differs, an idle daemon is replaced automatically; a busy one is kept and reported
   * through `onOutdated` so running shells are never killed behind the user's back.
   */
  expectedBuild?: string
}

export interface OutdatedDaemon {
  running: string | undefined
  expected: string
}

/**
 * Orders build ids (`<semver>+<hash>`, see daemonBuildId). Higher semver wins; equal versions with
 * different hashes are local development builds, where the client's code counts as newer. A
 * daemon without a build id predates build ids and is always older.
 */
export function compareBuilds(client: string, daemon: string | undefined): number {
  if (!daemon) return 1
  if (client === daemon) return 0
  const [cv = "", ch = ""] = client.split("+")
  const [dv = "", dh = ""] = daemon.split("+")
  const order = compareSemver(cv, dv)
  if (order !== 0) return order
  return ch === dh ? 0 : 1
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.split("-", 2)
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1 // 1.0.0 > 1.0.0-beta
  if (y.pre === undefined) return -1
  return x.pre < y.pre ? -1 : 1
}

const IDEMPOTENT = new Set<string>([
  "daemon.hello",
  "daemon.status",
  "shell.list",
  "shell.get",
  "shell.read",
  "shell.screen",
  "shell.wait",
])

type Listener = (data: unknown, topic: string) => void
export type ConnectionState = "connected" | "disconnected"

/**
 * Typed, reconnecting client for cockpitd. Calls transparently (re)connect and, when allowed,
 * start the daemon. Subscriptions survive reconnects.
 */
export class CockpitClient {
  readonly paths: CockpitPaths
  private connection: Connection | undefined
  private connecting: Promise<Connection> | undefined
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly stateListeners = new Set<(state: ConnectionState) => void>()
  private hello: HelloResult | undefined
  private closed = false
  private outdatedInfo: OutdatedDaemon | undefined
  private readonly outdatedListeners = new Set<(info: OutdatedDaemon | undefined) => void>()

  constructor(private readonly options: ClientOptions) {
    this.paths = options.paths ?? resolvePaths()
  }

  get daemon(): HelloResult | undefined {
    return this.hello
  }

  get connected(): boolean {
    return this.connection !== undefined && !this.connection.closed
  }

  async call<M extends MethodName>(method: M, ...args: ParamsArg<M>): Promise<ResultOf<Methods, M>> {
    const conn = await this.ensure()
    try {
      return (await conn.request(method, args[0])) as ResultOf<Methods, M>
    } catch (err) {
      // The daemon went away under us. Methods without side effects are safe to replay once.
      const lost =
        err instanceof RpcError && err.code === ErrorCode.ShuttingDown && conn.closed && !this.closed
      if (!lost || !IDEMPOTENT.has(method)) throw err
      const next = await this.ensure()
      return (await next.request(method, args[0])) as ResultOf<Methods, M>
    }
  }

  /** Listen to a topic. Returns an unsubscribe function. */
  on<T extends Topic>(topic: T, listener: (data: EventOf<Events, T>) => void): () => void {
    let set = this.listeners.get(topic)
    const isNew = !set
    if (!set) {
      set = new Set()
      this.listeners.set(topic, set)
    }
    set.add(listener as Listener)
    if (isNew && this.connected)
      void this.connection?.request("events.subscribe", { topics: [topic] }).catch(() => {})
    else if (isNew) void this.ensure().catch(() => {})
    return () => {
      set.delete(listener as Listener)
      if (set.size === 0) {
        this.listeners.delete(topic)
        if (this.connected)
          void this.connection?.request("events.unsubscribe", { topics: [topic] }).catch(() => {})
      }
    }
  }

  /** Set while connected to a daemon running different code than `expectedBuild`. */
  get outdated(): OutdatedDaemon | undefined {
    return this.outdatedInfo
  }

  onOutdated(listener: (info: OutdatedDaemon | undefined) => void): () => void {
    this.outdatedListeners.add(listener)
    return () => this.outdatedListeners.delete(listener)
  }

  /**
   * Stop the daemon and start a fresh one from this client's code. Without `force` it refuses
   * while shells are running. Returns false when refused.
   */
  async restartDaemon(options: { force?: boolean } = {}): Promise<boolean> {
    const conn = await this.ensure()
    const { accepted } = (await conn.request("daemon.shutdown", { force: options.force === true })) as {
      accepted: boolean
    }
    if (!accepted) return false
    await this.waitForSocketGone()
    await this.ensure()
    return true
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Connect now (spawning if configured). Useful to surface errors early. */
  async connect(): Promise<HelloResult> {
    await this.ensure()
    return this.hello as HelloResult
  }

  close(): void {
    this.closed = true
    this.connection?.close()
    this.connection = undefined
  }

  private ensure(): Promise<Connection> {
    if (this.closed) return Promise.reject(new RpcError(ErrorCode.ShuttingDown, "client closed"))
    if (this.connection && !this.connection.closed) return Promise.resolve(this.connection)
    this.connecting ??= this.establish().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  private async establish(replaced = false): Promise<Connection> {
    let conn = await this.tryOpen()
    if (!conn) {
      if (!this.options.spawn) {
        throw new RpcError(ErrorCode.ShuttingDown, `cockpitd is not running (${this.paths.socket})`)
      }
      const spawned = spawnDaemon(this.paths, this.options.spawn)
      try {
        conn = await this.waitForSocket(this.options.connectTimeoutMs ?? 8000)
      } finally {
        if (spawned) releaseSpawnLock(this.paths)
      }
    }

    try {
      this.hello = (await conn.request("daemon.hello", {
        client: this.options.client,
        protocol: PROTOCOL_VERSION,
      })) as HelloResult
    } catch (err) {
      conn.close()
      if (
        err instanceof RpcError &&
        err.code === ErrorCode.ProtocolMismatch &&
        this.options.spawn &&
        !replaced
      ) {
        return this.replaceIncompatibleDaemon(err)
      }
      throw err
    }

    const expected = this.options.expectedBuild
    // Only move forward: several plugins at different versions share one daemon, and letting an
    // older one replace a newer daemon would make them take turns replacing each other.
    if (expected && compareBuilds(expected, this.hello.build) > 0) {
      const status = (await conn.request("daemon.status", {})) as { modules: { busy: boolean }[] }
      const busy = status.modules.some((m) => m.busy)
      if (!busy && this.options.spawn && !replaced) {
        await conn.request("daemon.shutdown", {}).catch(() => {})
        conn.close()
        await this.waitForSocketGone()
        return this.establish(true)
      }
      this.setOutdated({ running: this.hello.build, expected })
    } else {
      this.setOutdated(undefined)
    }

    this.connection = conn
    const topics = [...this.listeners.keys()]
    if (topics.length > 0) await conn.request("events.subscribe", { topics })
    for (const l of this.stateListeners) l("connected")
    return conn
  }

  /** An older daemon speaks another protocol. Replace it only if nothing is running in it. */
  private async replaceIncompatibleDaemon(err: RpcError): Promise<Connection> {
    const data = err.data as { busy?: boolean } | undefined
    if (data?.busy) {
      throw new RpcError(
        ErrorCode.ProtocolMismatch,
        "cockpitd is running an incompatible version and has running shells; stop them or restart the daemon",
        err.data,
      )
    }
    const pid = await Bun.file(this.paths.pidFile)
      .text()
      .then((t) => Number.parseInt(t, 10))
      .catch(() => Number.NaN)
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, "SIGTERM")
      } catch {
        // already gone
      }
    }
    await this.waitForSocketGone()
    return this.establish(true)
  }

  private async waitForSocketGone(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    // Bun.file().exists() reports false for unix sockets; use a stat-based check.
    while (Date.now() < deadline && existsSync(this.paths.socket)) await Bun.sleep(50)
  }

  private setOutdated(info: OutdatedDaemon | undefined): void {
    const changed =
      info?.running !== this.outdatedInfo?.running ||
      (info === undefined) !== (this.outdatedInfo === undefined)
    this.outdatedInfo = info
    if (changed) for (const l of this.outdatedListeners) l(info)
  }

  private async tryOpen(): Promise<Connection | undefined> {
    try {
      return await Connection.open(
        this.paths.socket,
        (event) => this.dispatch(event),
        () => this.handleDisconnect(),
      )
    } catch {
      return undefined
    }
  }

  private async waitForSocket(timeoutMs: number): Promise<Connection> {
    const deadline = Date.now() + timeoutMs
    let delay = 25
    while (Date.now() < deadline) {
      const conn = await this.tryOpen()
      if (conn) return conn
      await Bun.sleep(delay)
      delay = Math.min(delay * 2, 250)
    }
    throw new RpcError(
      ErrorCode.ShuttingDown,
      `cockpitd did not start within ${timeoutMs}ms; see ${this.paths.logFile}`,
    )
  }

  private handleDisconnect(): void {
    this.connection = undefined
    for (const l of this.stateListeners) l("disconnected")
  }

  private dispatch(event: EventEnvelope): void {
    for (const listener of this.listeners.get(event.topic) ?? []) {
      try {
        listener(event.data, event.topic)
      } catch {
        // a listener's failure must not break delivery to others
      }
    }
  }
}

type ParamsArg<M extends MethodName> =
  undefined extends ParamsOf<Methods, M> ? [params?: ParamsOf<Methods, M>] : [params: ParamsOf<Methods, M>]
