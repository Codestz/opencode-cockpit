/** Wire envelope: JSON-RPC 2.0, one JSON object per line (ADR 0002). */

/** Bump MAJOR on breaking changes to methods, events or framing. */
export const PROTOCOL_VERSION = { major: 1, minor: 4 } as const

export type RequestId = number | string

export interface RpcRequest {
  jsonrpc: "2.0"
  id: RequestId
  method: string
  params?: unknown
}

export interface RpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export interface RpcSuccess {
  jsonrpc: "2.0"
  id: RequestId
  result: unknown
}

export interface RpcFailure {
  jsonrpc: "2.0"
  id: RequestId | null
  error: RpcErrorShape
}

export type RpcMessage = RpcRequest | RpcNotification | RpcSuccess | RpcFailure

export interface RpcErrorShape {
  code: number
  message: string
  data?: unknown
}

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Application range
  NotFound: -32001,
  InvalidState: -32002,
  ProtocolMismatch: -32003,
  SpawnFailed: -32004,
  ShuttingDown: -32005,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = "RpcError"
  }

  toShape(): RpcErrorShape {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }

  static from(shape: RpcErrorShape): RpcError {
    return new RpcError(shape.code, shape.message, shape.data)
  }
}

/** Method name for daemon → client notifications. */
export const EVENT_METHOD = "event"

export interface EventEnvelope<T extends string = string, D = unknown> {
  topic: T
  data: D
}

export function isRequest(msg: RpcMessage): msg is RpcRequest {
  return "method" in msg && "id" in msg && msg.id !== undefined
}

export function isNotification(msg: RpcMessage): msg is RpcNotification {
  return "method" in msg && !("id" in msg)
}

export function isResponse(msg: RpcMessage): msg is RpcSuccess | RpcFailure {
  return !("method" in msg) && ("result" in msg || "error" in msg)
}
