import type { MethodName, Methods, ParsedParamsOf, ResultOf } from "@opencode-cockpit/protocol"
import type { Logger } from "./logger.ts"

/** A connected client as seen by modules. */
export interface Peer {
  readonly id: number
  readonly name: string
  /** The OpenCode window this connection belongs to, when the client said. */
  readonly instance: string | undefined
  /** Send an event to this peer only, regardless of its subscriptions. */
  send(topic: string, data: unknown): void
  /** Run when the peer disconnects. */
  onClose(fn: () => void): void
  /** Topic patterns: exact (`shell.exited`), namespace (`shell.*`) or everything (`*`). */
  readonly topics: Set<string>
  greet(name: string, instance?: string): void
}

export interface CallContext {
  peer: Peer
}

export interface ModuleContext {
  log: Logger
  /** Broadcast to every peer subscribed to `topic`. */
  emit(topic: string, data: unknown): void
  /** OpenCode windows currently connected, by instance id. */
  instances(): Set<string>
}

type Handler<M extends MethodName> = (
  params: ParsedParamsOf<Methods, M>,
  call: CallContext,
) => Promise<ResultOf<Methods, M>> | ResultOf<Methods, M>

/** Handlers for the methods under one namespace, typed from the protocol contract. */
export type MethodTable<NS extends string> = {
  [M in MethodName as M extends `${NS}.${infer Rest}` ? Rest : never]: Handler<M>
}

export interface Module<NS extends string = string> {
  readonly name: NS
  /** Typed per namespace; erased to a plain record when modules are handled generically. */
  readonly methods: string extends NS ? object : MethodTable<NS>
  start(ctx: ModuleContext): Promise<void>
  stop(): Promise<void>
  /** A connection went away. The window may still be here through its other half. */
  peerClosed?(peer: Peer, remaining: Set<string>): void
  /** While true the daemon will not shut down for idleness. */
  busy(): boolean
}
