import { isAbsolute, relative, resolve } from "node:path"
import { type ToolContext, type ToolDefinition, tool } from "@opencode-ai/plugin"
import { type Log, silentLog } from "../../log.ts"
import type { CommandSpec, ServerHost, ToolCall } from "./parts.ts"
import { contentText } from "./v1.ts"

/** The parts of OpenCode 2.0.15's server plugin context used here (`@opencode/plugin`'s `Context`). */
export interface V2ServerContext {
  options?: unknown
  location?: { directory: string }
  tool?: {
    transform(edit: (editor: V2ToolEditor) => void): Promise<unknown>
    /** 2.0.18: after every tool call, Code Mode's inner calls included (docs/opencode/trail-server.md). */
    hook?(name: "execute.after", run: (event: V2ToolAfter) => unknown): Promise<unknown>
  }
  /** 2.0.15's skill registry: an added skill is offered to the model like the user's own. */
  skill?: { transform(edit: (editor: V2SkillEditor) => void): Promise<unknown> }
  /** 2.0.15's slash commands: code, not a template, so a shipped one prompts the session itself. */
  command?: { transform(edit: (editor: V2CommandEditor) => void): Promise<unknown> }
  session: {
    get(input: {
      sessionID: string
    }): Promise<{ parentID?: string; title?: string; agent?: string } | undefined>
    synthetic(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<unknown>
    /** A message from the person: what a command sends. */
    prompt?(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<unknown>
    /** A session's messages as the model is given them (2.0.15). */
    context?(input: { sessionID: string }): Promise<unknown[]>
    hook(name: "context", run: (event: { sessionID: string; system: unknown[] }) => unknown): Promise<unknown>
  }
  event: { subscribe(options: { signal: AbortSignal }): AsyncIterable<V2Event> }
}

export interface V2Event {
  type: string
  data?: { sessionID?: string }
}

/** What v2's `execute.after` hands a plugin, measured on 2.0.18. */
export interface V2ToolAfter {
  tool: string
  sessionID: string
  agent?: string
  messageID?: string
  /** The call's id. A Code Mode call fires twice with the same one: the inner tool, then `execute`. */
  id: string
  input?: unknown
  status?: string
  /** `content[].text` is the one field every tool has; `output` is a string for MCP, an object for `shell`. */
  result?: { output?: unknown; content?: unknown }
  error?: unknown
}

/**
 * Code Mode's outer call. On v2 a plugin or MCP tool is called from inside `execute`, and the hook
 * fires for both with the same id — the outer one carrying everything the code printed, `search(…)`
 * results (the tool catalog, URLs and all) included. Only the inner call is delivered.
 */
const CODE_MODE = "execute"

/** A v2 `execute.after` as a `ToolCall`, or undefined for Code Mode's outer call and a call that failed. */
export function v2ToolCall(event: V2ToolAfter): ToolCall | undefined {
  if (event.tool === CODE_MODE) return undefined
  if (event.error !== undefined || (event.status !== undefined && event.status !== "completed"))
    return undefined
  const text = contentText(event.result?.content)
  const output = text || (typeof event.result?.output === "string" ? event.result.output : "")
  return {
    sessionID: event.sessionID,
    tool: event.tool,
    callID: event.id,
    args: event.input,
    output,
    ...(event.agent ? { agent: event.agent } : {}),
  }
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

/** A skill as v2's registry holds one. */
export interface V2Skill {
  id: string
  name: string
  description?: string
  /** The `SKILL.md`: the model is told its folder, so the skill's relative paths resolve. */
  path: string
  content: string
}

interface V2SkillEditor {
  get(id: string): unknown
  add(skill: V2Skill): void
}

/** What v2 hands a command when it runs, measured on 2.0.18: `delivery` is `"steer"` even when idle. */
export interface V2CommandInvocation {
  sessionID: string
  prompt?: { text?: string }
  delivery?: "steer" | "queue"
}

interface V2CommandEditor {
  add(command: {
    name: string
    description?: string
    execute(input: V2CommandInvocation): Promise<void>
  }): void
}

/** The line a v2 command sends: the command's own, then whatever was typed after its name. */
export function commandText(command: CommandSpec, invocation: V2CommandInvocation): string {
  const typed = invocation.prompt?.text?.trim()
  return typed ? `${command.prompt}\n\n${typed}` : command.prompt
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
      context: async (id) => {
        const list = await ctx.session.context?.({ sessionID: id }).catch(() => undefined)
        return Array.isArray(list) ? list : []
      },
      notify: async (id, text, options) => {
        await ctx.session.synthetic({
          sessionID: id,
          text,
          ...(options?.steer ? { delivery: "steer" as const } : {}),
        })
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
