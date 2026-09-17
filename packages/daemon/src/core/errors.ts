import { ErrorCode, RpcError } from "@opencode-cockpit/protocol"

export const notFound = (what: string) => new RpcError(ErrorCode.NotFound, `${what} not found`)
export const invalidState = (message: string) => new RpcError(ErrorCode.InvalidState, message)
export const invalidParams = (message: string, data?: unknown) =>
  new RpcError(ErrorCode.InvalidParams, message, data)
