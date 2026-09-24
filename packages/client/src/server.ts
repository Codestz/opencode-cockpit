/**
 * What a Cockpit server half needs from OpenCode, whichever OpenCode it is — `host.ts` for the agent
 * side.
 *
 * A feature is written once as a `ServerStart`: given a `ServerHost` it answers with its tools and the
 * few hooks it uses (`ServerParts`). `dualServer` turns that into an entry both versions load: v1 calls
 * `server(input)` and gets hooks back, v2 calls `setup(ctx)` and the parts are registered on its
 * domains. Tools stay written with v1's `tool()`, whose arguments are zod — v2 is handed their JSON
 * Schema, and the arguments are parsed here so defaults apply the same on both.
 *
 * Only `tool` (for its zod) is imported from OpenCode at runtime; the v2 context is described by the
 * structural types below.
 */

import { isAbsolute, relative, resolve } from "node:path"
import {
  type Hooks,
  type PluginInput,
  type ToolContext,
  type ToolDefinition,
  tool,
} from "@opencode-ai/plugin"
import { cockpitVersion, createLog, type Log, silentLog } from "./log.ts"

export interface ServerHost {
  readonly version: 1 | 2
  /** The project this OpenCode was opened in. */
  readonly directory: string
  /** One object per OpenCode instance, shared by every Cockpit plugin in it — for `claimFeature`. */
  readonly scope: object
  readonly session: {
    get(id: string): Promise<{ parentID?: string; title?: string } | undefined>
    /** A message from the plugin rather than the person, which starts a turn: v1's synthetic prompt. */
    notify(id: string, text: string): Promise<void>
  }
  /** A project file's text, or undefined when there is none — or the path leaves the project. */
  readFile(path: string): Promise<string | undefined>
  /** The shared log (`cockpit.log`), scoped `server`; a feature takes `log.child("shell")`. */
  readonly log: Log
}

export interface ServerParts {
  tools?: Record<string, ToolDefinition>
  /** Added to the system prompt of each model request. The session is unknown on some v1 requests. */
  system?: (sessionID: string | undefined) => Promise<string[]>
  sessionDeleted?: (sessionID: string) => Promise<void>
  dispose?: () => Promise<void> | void
}

export type ServerStart = (host: ServerHost, options: unknown) => Promise<ServerParts>

/** Several features as one: tools unioned (a clash is a bug, so it throws), hooks run in order. */
export function composeParts(parts: ServerParts[]): ServerParts {
  const tools: Record<string, ToolDefinition> = {}
  for (const part of parts) {
    for (const [name, def] of Object.entries(part.tools ?? {})) {
      if (name in tools) throw new Error(`tool "${name}" is registered by more than one cockpit feature`)
      tools[name] = def
    }
  }
  /** Only what some feature has: no features is no hooks at all, not hooks that do nothing. */
  const any = (key: keyof ServerParts) => parts.some((part) => part[key] !== undefined)
  return {
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    ...(any("system")
      ? {
          system: async (sessionID: string | undefined) => {
            const lines: string[] = []
            for (const part of parts) lines.push(...((await part.system?.(sessionID)) ?? []))
            return lines
          },
        }
      : {}),
    ...(any("sessionDeleted")
      ? {
          sessionDeleted: async (sessionID: string) => {
            for (const part of parts) await part.sessionDeleted?.(sessionID)
          },
        }
      : {}),
    ...(any("dispose")
      ? {
          dispose: async () => {
            for (const part of parts) await part.dispose?.()
          },
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------------------------------
// v1

/** v1 also has a log of its own, where people already look: warnings and errors go there too. */
function alsoToV1(log: Log, client: PluginInput["client"]): Log {
  const forward = (level: "warn" | "error", message: string) =>
    // Logging through the server while plugins initialise could wait on ourselves; defer it.
    setTimeout(() => {
      void client.app.log({ body: { service: "opencode-cockpit", level, message } }).catch(() => {})
    }, 0)
  return {
    ...log,
    warn: (msg, fields) => {
      log.warn(msg, fields)
      forward("warn", msg)
    },
    error: (msg, fields) => {
      log.error(msg, fields)
      forward("error", msg)
    },
    child: (scope) => alsoToV1(log.child(scope), client),
  }
}

export function serverFromV1(input: PluginInput, log: Log = silentLog): ServerHost {
  const { client, directory } = input
  return {
    version: 1,
    directory,
    scope: input,
    session: {
      get: async (id) => {
        const result = await client.session.get({ path: { id } }).catch(() => undefined)
        return result?.data as { parentID?: string; title?: string } | undefined
      },
      notify: async (id, text) => {
        await client.session.promptAsync({
          path: { id },
          body: { parts: [{ type: "text", text, synthetic: true } as never] },
        })
      },
    },
    readFile: async (path) => {
      const result = await client.file.read({ query: { path } }).catch(() => undefined)
      const content = (result?.data as { content?: string } | undefined)?.content
      return typeof content === "string" ? content : undefined
    },
    log: alsoToV1(log, client),
  }
}

export function partsToV1Hooks(parts: ServerParts): Hooks {
  return {
    ...(parts.tools ? { tool: parts.tools } : {}),
    ...(parts.system
      ? {
          "experimental.chat.system.transform": async (input, output) => {
            output.system.push(...((await parts.system?.(input.sessionID)) ?? []))
          },
        }
      : {}),
    ...(parts.sessionDeleted
      ? {
          event: async ({ event }) => {
            if (event.type === "session.deleted") await parts.sessionDeleted?.(event.properties.info.id)
          },
        }
      : {}),
    ...(parts.dispose ? { dispose: async () => parts.dispose?.() } : {}),
  } as Hooks
}

// ---------------------------------------------------------------------------------------------------
// v2

/** The parts of OpenCode 2.0.15's server plugin context used here (`@opencode/plugin`'s `Context`). */
export interface V2ServerContext {
  options?: unknown
  location?: { directory: string }
  tool?: { transform(edit: (editor: V2ToolEditor) => void): Promise<unknown> }
  session: {
    get(input: { sessionID: string }): Promise<{ parentID?: string; title?: string } | undefined>
    synthetic(input: { sessionID: string; text: string }): Promise<unknown>
    hook(name: "context", run: (event: { sessionID: string; system: unknown[] }) => unknown): Promise<unknown>
  }
  event: { subscribe(options: { signal: AbortSignal }): AsyncIterable<V2Event> }
}

interface V2Event {
  type: string
  data?: { sessionID?: string }
}

/** A tool as v2's editor takes one. */
export interface V2Tool {
  name: string
  description: string
  input: unknown
  execute: (input: unknown, context: V2ToolContext) => Promise<{ content?: string; metadata?: unknown }>
}

interface V2ToolEditor {
  add(tool: V2Tool): void
}

export interface V2ToolContext {
  sessionID: string
  agent: string
  messageID: string
  signal: AbortSignal
  progress: (update: Record<string, unknown>) => Promise<void>
}

/**
 * v1 scoped claims to the plugin input, which every plugin of an instance shares. v2 hands each plugin
 * its own context, so the shared object is kept here instead, by directory — on `globalThis`, so two
 * copies of this package (the bundle and a feature package) still find the same one.
 */
const SCOPES = Symbol.for("opencode-cockpit.server-scopes")
function scopeFor(directory: string): object {
  const global = globalThis as { [SCOPES]?: Map<string, object> }
  global[SCOPES] ??= new Map()
  let scope = global[SCOPES].get(directory)
  if (!scope) {
    scope = { directory }
    global[SCOPES].set(directory, scope)
  }
  return scope
}

export function serverFromV2(
  ctx: V2ServerContext & { location: { directory: string } },
  log: Log = silentLog,
): ServerHost {
  const directory = ctx.location.directory
  return {
    version: 2,
    directory,
    scope: scopeFor(directory),
    session: {
      get: (id) => ctx.session.get({ sessionID: id }).catch(() => undefined),
      notify: async (id, text) => {
        await ctx.session.synthetic({ sessionID: id, text })
      },
    },
    /** v2 gives plugins no file API; the file system, kept inside the project, reads the same text. */
    readFile: async (path) => {
      const full = resolve(directory, path)
      const inside = relative(directory, full)
      if (inside.startsWith("..") || isAbsolute(inside)) return undefined
      const file = Bun.file(full)
      return (await file.exists()) ? await file.text().catch(() => undefined) : undefined
    },
    log,
  }
}

/** A v1 tool as v2 registers one: JSON Schema in, arguments parsed here, text out. */
export function toolToV2(name: string, def: ToolDefinition, directory: string): V2Tool {
  const args = tool.schema.object(def.args)
  return {
    name,
    description: def.description,
    /** As the model writes them, not as they come out: an argument with a default is optional. */
    input: tool.schema.toJSONSchema(args, { io: "input" }),
    execute: async (input: unknown, context: V2ToolContext) => {
      const v1: ToolContext = {
        sessionID: context.sessionID,
        messageID: context.messageID,
        agent: context.agent,
        directory,
        worktree: directory,
        abort: context.signal,
        metadata: (update) => void context.progress(update).catch(() => {}),
        /** v2 asks for a plugin tool's own permission before it runs; there is no second prompt to raise. */
        ask: async () => {},
      }
      const result = await def.execute(args.parse(input ?? {}), v1)
      return typeof result === "string"
        ? { content: result }
        : { content: result.output, ...(result.metadata ? { metadata: result.metadata } : {}) }
    },
  }
}

// ---------------------------------------------------------------------------------------------------
// both

/**
 * Every tool call through the log: a failure with its tool and stack — tools fail in front of the
 * agent, not the person, so this is the only record — and, with `COCKPIT_DEBUG`, every call and how
 * long it took.
 */
function loggedTools(tools: Record<string, ToolDefinition> | undefined, log: Log) {
  if (!tools) return undefined
  const out: Record<string, ToolDefinition> = {}
  for (const [name, def] of Object.entries(tools)) {
    out[name] = {
      ...def,
      execute: async (args, context) => {
        const started = performance.now()
        try {
          const result = await def.execute(args, context)
          log.debug("tool", { tool: name, ms: Math.round(performance.now() - started) })
          return result
        } catch (error) {
          log.warn("tool failed", { tool: name, ms: Math.round(performance.now() - started), error })
          throw error
        }
      },
    }
  }
  return out
}

/** Starts a feature: what loaded and where first, so a feature that never answers still said it was loaded. */
async function begin(
  id: string,
  host: ServerHost,
  start: ServerStart,
  options: unknown,
): Promise<ServerParts> {
  host.log.info("start", { entry: id, opencode: host.version, cockpit: cockpitVersion() })
  try {
    const parts = await start(host, options)
    return { ...parts, tools: loggedTools(parts.tools, host.log) }
  } catch (error) {
    host.log.error("start failed", { entry: id, error })
    throw error
  }
}

/** One feature as an entry both versions load. */
export function dualServer(id: string, start: ServerStart) {
  return {
    id,
    server: async (input: PluginInput, options?: unknown): Promise<Hooks> =>
      partsToV1Hooks(await begin(id, serverFromV1(input, createLog("server")), start, options)),
    setup: async (ctx: V2ServerContext) => {
      /**
       * v1 1.18.29+ calls `setup` too (older releases never do), with a preview context that has
       * neither tools nor a location (docs/opencode/v2.md). Registering there would be registering twice.
       */
      if (!ctx.tool || !ctx.location) return
      const host = serverFromV2(
        ctx as V2ServerContext & { location: { directory: string } },
        createLog("server"),
      )
      const parts = await begin(id, host, start, ctx.options)
      const tools = Object.entries(parts.tools ?? {})
      if (tools.length > 0) {
        await ctx.tool.transform((editor) => {
          for (const [name, def] of tools) editor.add(toolToV2(name, def, host.directory))
        })
      }
      if (parts.system) {
        const system = parts.system
        await ctx.session.hook("context", async (event) => {
          for (const text of await system(event.sessionID)) event.system.push({ type: "text", text })
        })
      }
      const stop = new AbortController()
      if (parts.sessionDeleted) {
        const deleted = parts.sessionDeleted
        void (async () => {
          for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
            const sessionID = event.data?.sessionID
            if (event.type === "session.deleted" && sessionID) {
              await deleted(sessionID).catch((error) =>
                host.log.warn("session cleanup failed", { sessionID, error }),
              )
            }
          }
        })().catch((error) => host.log.warn("event stream ended", { error }))
      }
      return async () => {
        stop.abort()
        await parts.dispose?.()
      }
    },
  }
}
