import {
  ErrorCode,
  EVENT_METHOD,
  encodeFrame,
  LineDecoder,
  RpcError,
  type RpcMessage,
  type RpcRequest,
} from "@opencode-cockpit/protocol"
import type { Socket, UnixSocketListener } from "bun"
import type { Logger } from "./logger.ts"
import type { Peer } from "./module.ts"
import type { Router } from "./router.ts"

const MAX_QUEUED_BYTES = 32 * 1024 * 1024

interface ConnState {
  peer: PeerImpl
}

class PeerImpl implements Peer {
  name = "unknown"
  greeted = false
  readonly topics = new Set<string>()
  private readonly closers: (() => void)[] = []
  private queue: Uint8Array[] = []
  private queued = 0
  closed = false

  constructor(
    readonly id: number,
    private readonly socket: Socket<ConnState>,
    private readonly log: Logger,
  ) {}

  greet(name: string): void {
    this.name = name
    this.greeted = true
  }

  onClose(fn: () => void): void {
    if (this.closed) fn()
    else this.closers.push(fn)
  }

  send(topic: string, data: unknown): void {
    this.write({ jsonrpc: "2.0", method: EVENT_METHOD, params: { topic, data } })
  }

  subscribed(topic: string): boolean {
    if (this.topics.has(topic) || this.topics.has("*")) return true
    const dot = topic.indexOf(".")
    return dot > 0 && this.topics.has(`${topic.slice(0, dot)}.*`)
  }

  write(message: unknown): void {
    if (this.closed) return
    const frame = encodeFrame(message)
    if (this.queue.length > 0) {
      this.enqueue(frame)
      return
    }
    const written = this.socket.write(frame)
    if (written < frame.byteLength) this.enqueue(frame.subarray(Math.max(0, written)))
  }

  drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0] as Uint8Array
      const written = this.socket.write(head)
      if (written < head.byteLength) {
        this.queue[0] = head.subarray(Math.max(0, written))
        this.queued -= Math.max(0, written)
        return
      }
      this.queue.shift()
      this.queued -= head.byteLength
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queue = []
    for (const fn of this.closers.splice(0)) {
      try {
        fn()
      } catch (err) {
        this.log.warn("peer close hook failed", { err: String(err) })
      }
    }
  }

  private enqueue(frame: Uint8Array): void {
    this.queue.push(frame)
    this.queued += frame.byteLength
    if (this.queued > MAX_QUEUED_BYTES) {
      this.log.warn("peer too slow, disconnecting", { peer: this.id, queued: this.queued })
      this.socket.end()
    }
  }
}

export interface RpcServerHooks {
  onConnect(count: number): void
  onDisconnect(count: number): void
}

export class RpcServer {
  private listener: UnixSocketListener<ConnState> | undefined
  private readonly peers = new Set<PeerImpl>()
  private nextId = 1

  constructor(
    private readonly router: Router,
    private readonly hooks: RpcServerHooks,
    private readonly log: Logger,
  ) {}

  get clientCount(): number {
    return this.peers.size
  }

  listen(path: string): void {
    const decoders = new WeakMap<PeerImpl, LineDecoder>()
    this.listener = Bun.listen<ConnState>({
      unix: path,
      socket: {
        open: (socket) => {
          const peer = new PeerImpl(this.nextId++, socket, this.log)
          socket.data = { peer }
          decoders.set(peer, new LineDecoder())
          this.peers.add(peer)
          this.hooks.onConnect(this.peers.size)
        },
        data: (socket, chunk) => {
          const peer = socket.data.peer
          let lines: string[]
          try {
            lines = (decoders.get(peer) as LineDecoder).push(chunk)
          } catch (err) {
            peer.write({
              jsonrpc: "2.0",
              id: null,
              error: { code: ErrorCode.ParseError, message: String(err) },
            })
            socket.end()
            return
          }
          for (const line of lines) void this.handleLine(peer, line)
        },
        drain: (socket) => socket.data.peer.drain(),
        close: (socket) => this.drop(socket.data.peer),
        error: (socket, err) => {
          this.log.warn("socket error", { err: String(err) })
          this.drop(socket.data.peer)
        },
      },
    })
  }

  broadcast(topic: string, data: unknown): void {
    for (const peer of this.peers) if (peer.subscribed(topic)) peer.send(topic, data)
  }

  stop(): void {
    this.listener?.stop(true)
    for (const peer of this.peers) peer.close()
    this.peers.clear()
  }

  private drop(peer: PeerImpl): void {
    if (!this.peers.delete(peer)) return
    peer.close()
    this.hooks.onDisconnect(this.peers.size)
  }

  private async handleLine(peer: PeerImpl, line: string): Promise<void> {
    let message: RpcMessage
    try {
      message = JSON.parse(line)
    } catch {
      peer.write({ jsonrpc: "2.0", id: null, error: { code: ErrorCode.ParseError, message: "invalid JSON" } })
      return
    }
    if (
      typeof message !== "object" ||
      message === null ||
      !("method" in message) ||
      typeof message.method !== "string"
    ) {
      peer.write({
        jsonrpc: "2.0",
        id: null,
        error: { code: ErrorCode.InvalidRequest, message: "expected a request" },
      })
      return
    }
    const hasId = "id" in message && (typeof message.id === "number" || typeof message.id === "string")
    const request = message as RpcRequest
    try {
      const result = await this.invoke(peer, request)
      if (hasId) peer.write({ jsonrpc: "2.0", id: request.id, result: result ?? {} })
    } catch (err) {
      const rpc =
        err instanceof RpcError
          ? err
          : new RpcError(ErrorCode.InternalError, err instanceof Error ? err.message : String(err))
      if (!(err instanceof RpcError))
        this.log.error("handler crashed", { method: request.method, err: String(err) })
      if (hasId) peer.write({ jsonrpc: "2.0", id: request.id, error: rpc.toShape() })
    }
  }

  private async invoke(peer: PeerImpl, request: RpcRequest): Promise<unknown> {
    if (!peer.greeted && request.method !== "daemon.hello") {
      throw new RpcError(ErrorCode.InvalidRequest, "call daemon.hello first")
    }
    return this.router.dispatch(request.method, request.params, { peer })
  }
}

export type { PeerImpl }
