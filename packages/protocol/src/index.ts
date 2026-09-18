import type { EventContract } from "./contract.ts"
import { daemonContract } from "./daemon.ts"
import { shellContract, shellEvents } from "./shell/index.ts"

export * from "./build.ts"
export * from "./contract.ts"
export * from "./daemon.ts"
export * from "./framing.ts"
export * from "./paths.ts"
export * from "./rpc.ts"
export * as shell from "./shell/index.ts"

/** Every method the daemon serves. Adding a module means spreading its contract here. */
export const contract = { ...daemonContract, ...shellContract }
export type Methods = typeof contract
export type MethodName = keyof Methods

/** Every event topic the daemon emits. */
export const events = { ...shellEvents } satisfies EventContract
export type Events = typeof events
export type Topic = keyof Events
