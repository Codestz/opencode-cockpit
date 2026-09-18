import { z } from "zod"
import { method } from "./contract.ts"

export const ClientInfo = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  pid: z.number().int().optional(),
  /**
   * Opaque id of the OpenCode window this client belongs to. Both halves of a plugin share one, so
   * the daemon can tell "this window went away" from "one of its two connections dropped".
   */
  instance: z.string().min(1).optional(),
})

export const Version = z.object({ major: z.number().int(), minor: z.number().int() })

export const HelloResult = z.object({
  daemonVersion: z.string(),
  /** Content identity of the running daemon code (see daemonBuildId). */
  build: z.string().optional(),
  protocol: Version,
  modules: z.array(z.string()),
  pid: z.number().int(),
  startedAt: z.number(),
})

export const StatusResult = z.object({
  pid: z.number().int(),
  uptimeMs: z.number(),
  clients: z.number().int(),
  modules: z.array(z.object({ name: z.string(), busy: z.boolean() })),
})

export const daemonContract = {
  "daemon.hello": method(z.object({ client: ClientInfo, protocol: Version }), HelloResult),
  "daemon.status": method(z.object({}).optional(), StatusResult),
  "daemon.shutdown": method(
    z.object({ force: z.boolean().optional() }).optional(),
    z.object({ accepted: z.boolean() }),
  ),
  "events.subscribe": method(
    z.object({ topics: z.array(z.string().min(1)).min(1) }),
    z.object({ topics: z.array(z.string()) }),
  ),
  "events.unsubscribe": method(
    z.object({ topics: z.array(z.string().min(1)).min(1) }),
    z.object({ topics: z.array(z.string()) }),
  ),
}

export type HelloResult = z.output<typeof HelloResult>
export type StatusResult = z.output<typeof StatusResult>
export type ClientInfo = z.output<typeof ClientInfo>
