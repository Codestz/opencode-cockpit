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
 * structural types in `v2.ts`. This file is the entry both load; `parts.ts` is what a feature
 * answers with, `v1.ts` and `v2.ts` build the host, `skills.ts` reads a skill's folder.
 */

import type { Hooks, PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import { cockpitVersion, createLog, type Log } from "../../log.ts"
import { setupServer } from "../../setup/server.ts"
import { recordAgent } from "../service.ts"
import { composeParts, type ServerHost, type ServerParts, type ServerStart, type ToolCall } from "./parts.ts"
import { readSkill } from "./skills.ts"
import { registerSurfaces } from "./surfaces.ts"
import { partsToV1Hooks, serverFromV1 } from "./v1.ts"
import { commandText, serverFromV2, toolToV2, type V2Event, type V2ServerContext, v2ToolCall } from "./v2.ts"

export * from "./parts.ts"
export * from "./skills.ts"
export { keyText, openText, type Surface, surfacesLine } from "./surfaces.ts"
export { addToV1Config, partsToV1Hooks, serverFromV1, v1ToolText } from "./v1.ts"
export * from "./v2.ts"

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

/**
 * v2's event stream, kept open. A stream that ends or throws — a reloaded location, a restarted
 * service — used to stay closed, and every session deleted after it left its shells behind until
 * OpenCode restarted. It is opened again, waiting longer each time it fails straight away, and a
 * stream that ran a while starts the wait over.
 */
export async function follow(
  ctx: Pick<V2ServerContext, "event">,
  signal: AbortSignal,
  log: Log,
  handle: (event: V2Event) => Promise<void>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<void> {
  let delay = 1_000
  while (!signal.aborted) {
    const opened = Date.now()
    try {
      for await (const event of ctx.event.subscribe({ signal })) await handle(event)
      if (!signal.aborted) log.warn("event stream ended; opening it again", { waitMs: delay })
    } catch (error) {
      if (signal.aborted) return
      log.warn("event stream failed; opening it again", { waitMs: delay, error })
    }
    if (signal.aborted) return
    if (Date.now() - opened > 60_000) delay = 1_000
    await wait(delay)
    delay = Math.min(delay * 2, 30_000)
  }
}

/**
 * The Cockpit-wide line (`surfaces.ts`) ahead of the entry's own guidance, when this entry is the one
 * in the window that says it. Said to the main agent only — a subagent answers its caller, not the
 * user — and to a request whose session is unknown, as the guidance is.
 */
function withSurfaces(host: ServerHost, parts: ServerParts): ServerParts {
  if (!parts.surfaces?.length) return parts
  const entry = registerSurfaces(host.scope, parts.surfaces)
  /** Parentage never changes: asked once per session. */
  const parented = new Map<string, boolean>()
  const subagent = async (sessionID: string): Promise<boolean> => {
    const known = parented.get(sessionID)
    if (known !== undefined) return known
    const session = await host.session.get(sessionID).catch(() => undefined)
    if (!session) return false
    const answer = Boolean(session.parentID)
    parented.set(sessionID, answer)
    return answer
  }
  const { system, dispose } = parts
  return {
    ...parts,
    system: async (sessionID) => {
      const own = (await system?.(sessionID)) ?? []
      const line = entry.line()
      if (!line || (sessionID && (await subagent(sessionID)))) return own
      return [line, ...own]
    },
    dispose: async () => {
      entry.release()
      await dispose?.()
    },
  }
}

/** Starts a feature: what loaded and where first, so a feature that never answers still said it was loaded. */
async function begin(
  id: string,
  host: ServerHost,
  start: ServerStart,
  options: unknown,
): Promise<ServerParts> {
  host.log.info("start", { entry: id, opencode: host.version, cockpit: cockpitVersion() })
  /** Which install this agent side loaded, for a window to compare with its own (service.ts). */
  if (host.version === 2) recordAgent(host.log)
  try {
    /** `cockpit_settings`, the `cockpit-setup` skill and `/cockpit-setup`: the first entry here adds them. */
    const parts = withSurfaces(host, composeParts([await start(host, options), setupServer(host, id)]))
    const { toolAfter } = parts
    return {
      ...parts,
      tools: loggedTools(parts.tools, host.log),
      /** Listening to a call must never break it: a failure is logged and goes no further. */
      ...(toolAfter
        ? {
            toolAfter: async (call: ToolCall) => {
              try {
                await toolAfter(call)
              } catch (error) {
                host.log.warn("toolAfter failed", { tool: call.tool, error })
              }
            },
          }
        : {}),
    }
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
      const skills = (parts.skills ?? []).flatMap((spec) => {
        const skill = readSkill(spec)
        if (!skill) host.log.warn("skill not found", { dir: spec.dir })
        return skill ? [skill] : []
      })
      if (skills.length > 0) {
        if (ctx.skill) {
          await ctx.skill.transform((editor) => {
            for (const skill of skills) if (!editor.get(skill.id)) editor.add(skill)
          })
        } else
          host.log.warn("this OpenCode takes no skills from plugins", { skills: skills.map((s) => s.id) })
      }
      const commands = parts.commands ?? []
      if (commands.length > 0) {
        if (ctx.command && ctx.session.prompt) {
          const prompt = ctx.session.prompt.bind(ctx.session)
          await ctx.command.transform((editor) => {
            for (const command of commands)
              editor.add({
                name: command.name,
                description: command.description,
                /**
                 * Queued, always: v2 hands every command `delivery: "steer"`, which cuts a reply in
                 * progress off to start on this. Queued, an idle session starts at once and a busy
                 * one shows `1 queued` and waits (measured on 2.0.18).
                 */
                execute: async (invocation) => {
                  await prompt({
                    sessionID: invocation.sessionID,
                    text: commandText(command, invocation),
                    delivery: "queue",
                  })
                },
              })
          })
        } else host.log.warn("this OpenCode takes no commands from plugins", { commands: commands.length })
      }
      if (parts.toolAfter) {
        const after = parts.toolAfter
        if (ctx.tool.hook) {
          await ctx.tool.hook("execute.after", async (event) => {
            const call = v2ToolCall(event)
            if (call) await after(call)
          })
        } else host.log.warn("this OpenCode has no execute.after hook; tool output is not followed")
      }
      if (parts.system) {
        const system = parts.system
        await ctx.session.hook("context", async (event) => {
          for (const text of await system(event.sessionID)) event.system.push({ type: "text", text })
        })
      }
      const stop = new AbortController()
      if (parts.sessionDeleted || parts.event) {
        const { sessionDeleted: deleted, event: each } = parts
        void follow(ctx, stop.signal, host.log, async (event) => {
          const sessionID = event.data?.sessionID
          if (deleted && event.type === "session.deleted" && sessionID) {
            await deleted(sessionID).catch((error) =>
              host.log.warn("session cleanup failed", { sessionID, error }),
            )
          }
          if (each)
            await Promise.resolve(each(event)).catch((error) => host.log.warn("event failed", { error }))
        })
      }
      return async () => {
        stop.abort()
        await parts.dispose?.()
      }
    },
  }
}
