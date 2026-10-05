import {
  ErrorCode,
  EVENT_METHOD,
  type EventEnvelope,
  encodeFrame,
  LineDecoder,
  type RequestId,
  RpcError,
  type RpcMessage,
} from "@opencode-cockpit/protocol"
import type { Socket } from "bun"

interface Pending {
  resolve(value: unknown): void
  reject(err: unknown): void
}

/** One socket to the daemon: request/response correlation, events, write backpressure. */
export class Connection {
  private readonly pending = new Map<RequestId, Pending>()
  private readonly decoder = new LineDecoder()
  private queue: Uint8Array[] = []
  private nextId = 1
  private closedFlag = false

  private constructor(
    private socket: Socket<undefined>,
    private readonly onEvent: (event: EventEnvelope) => void,
    private readonly onClose: () => void,
  ) {}

  static open(path: string, onEvent: (e: EventEnvelope) => void, onClose: () => void): Promise<Connection> {
    return new Promise((resolve, reject) => {
      let conn: Connection | undefined
      Bun.connect<undefined>({
        unix: path,
        socket: {
          open(socket) {
            conn = new Connection(socket, onEvent, onClose)
            resolve(conn)
          },
          data(_socket, chunk) {
            conn?.receive(chunk)
          },
          drain() {
            conn?.drain()
          },
          close() {
            conn?.handleClose()
          },
          error(_socket, err) {
            if (conn) conn.handleClose()
            else reject(err)
          },
          connectError(_socket, err) {
            reject(err)
          },
        },
      }).catch(reject)
    })
  }

  get closed(): boolean {
    return this.closedFlag
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closedFlag) return Promise.reject(new RpcError(ErrorCode.ShuttingDown, "connection closed"))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: "2.0", id, method, params })
    })
  }

  close(): void {
    this.socket.end()
    this.handleClose()
  }

  private write(message: unknown): void {
    const frame = encodeFrame(message)
    if (this.queue.length > 0) {
      this.queue.push(frame)
      return
    }
    const written = this.socket.write(frame)
    if (written < frame.byteLength) this.queue.push(frame.subarray(Math.max(0, written)))
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0] as Uint8Array
      const written = this.socket.write(head)
      if (written < head.byteLength) {
        this.queue[0] = head.subarray(Math.max(0, written))
        return
      }
      this.queue.shift()
    }
  }

  private receive(chunk: Uint8Array): void {
    for (const line of this.decoder.push(chunk)) {
      let message: RpcMessage
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if ("method" in message) {
        if (message.method === EVENT_METHOD) this.onEvent(message.params as EventEnvelope)
        continue
      }
      if (message.id === null) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      if ("error" in message) pending.reject(RpcError.from(message.error))
      else pending.resolve(message.result)
    }
  }

  private handleClose(): void {
    if (this.closedFlag) return
    this.closedFlag = true
    const error = new RpcError(ErrorCode.ShuttingDown, "connection to cockpitd closed")
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.onClose()
  }
}
