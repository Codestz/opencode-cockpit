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

import { readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import {
  type Hooks,
  type PluginInput,
  type ToolContext,
  type ToolDefinition,
  tool,
} from "@opencode-ai/plugin"
import { cockpitVersion, createLog, type Log, silentLog } from "./log.ts"
import { recordAgent } from "./service.ts"
import { setupServer } from "./setup.ts"
import { registerSurfaces, type Surface } from "./surfaces.ts"

export { keyText, openText, type Surface, surfacesLine } from "./surfaces.ts"

export interface ServerHost {
  readonly version: 1 | 2
  /** The project this OpenCode was opened in. */
  readonly directory: string
  /** One object per OpenCode instance, shared by every Cockpit plugin in it — for `claimFeature`. */
  readonly scope: object
  readonly session: {
    /** `agent` is the agent running in the session (`general`, `explore`…), when the host says. */
    get(id: string): Promise<{ parentID?: string; title?: string; agent?: string } | undefined>
    /**
     * Whether a session is working on a turn right now. OpenCode 1 only: OpenCode 2's agent side has
     * no status call, so a feature that needs it there follows the session events itself.
     */
    busy?(id: string): Promise<boolean | undefined>
    /** A session's child sessions — its subagents. OpenCode 1 only: OpenCode 2 gives plugins no list. */
    children?(id: string): Promise<
      {
        id: string
        title?: string
        parentID?: string
        agent?: string
        time?: { created?: number; updated?: number }
      }[]
    >
    /** A session's messages with their parts, as OpenCode 1 stores them. OpenCode 1 only. */
    messages?(id: string): Promise<{ info: unknown; parts: unknown[] }[]>
    /**
     * A session's messages as OpenCode 2 stores them (`{ type: "user" | "assistant", … }`), read
     * through `session.context`: what the model is given, so a compacted session starts at its
     * summary. OpenCode 2 only; OpenCode 1 has `messages`.
     */
    context?(id: string): Promise<unknown[]>
    /**
     * A message from the plugin rather than the person, which starts a turn: v1's synthetic prompt.
     *
     * `steer` is for a session that is busy: OpenCode 2 then hands the message to the running turn
     * instead of queueing it after that turn ends — which, for a subagent, is after it has answered
     * and nobody is listening. OpenCode 1 needs nothing: a prompt sent to a busy session is picked up
     * mid-run (measured, docs/opencode/agents.md).
     */
    notify(id: string, text: string, options?: { steer?: boolean }): Promise<void>
  }
  /** A project file's text, or undefined when there is none — or the path leaves the project. */
  readFile(path: string): Promise<string | undefined>
  /** The shared log (`cockpit.log`), scoped `server`; a feature takes `log.child("shell")`. */
  readonly log: Log
}

/** A tool call that finished, as `toolAfter` hears of it on either version. */
export interface ToolCall {
  sessionID: string
  /** As the host names it: `bash`/`shell`, a plugin's `trail_add`, an MCP server's `<server>_<tool>`. */
  tool: string
  callID: string
  /** What the model sent. */
  args: unknown
  /** What the tool answered, as text — whichever field the host put it in. */
  output: string
  /** The agent that made the call (`general`, `explore`…). OpenCode 2 only. */
  agent?: string
}

/**
 * A skill shipped in a package: the folder holding its `SKILL.md`, whose frontmatter names it. OpenCode 1
 * reads the folder (`skills.paths`), OpenCode 2 is handed the file's text (`ctx.skill`): either way the
 * skill's files stay in the installed package and nothing is written to the user's config
 * (docs/opencode/shipping-agents.md).
 */
export interface SkillSpec {
  dir: string
}

/**
 * A slash command shipped from the agent side: one line of prompt. OpenCode then does what it does for
 * its own commands — from home it opens a conversation, while the agent answers it queues — on both
 * versions (measured on 1.18.32 and 2.0.18). Whatever is typed after the name follows the line.
 */
export interface CommandSpec {
  name: string
  description: string
  prompt: string
}

export interface ServerParts {
  tools?: Record<string, ToolDefinition>
  skills?: SkillSpec[]
  commands?: CommandSpec[]
  /** Added to the system prompt of each model request. The session is unknown on some v1 requests. */
  system?: (sessionID: string | undefined) => Promise<string[]>
  /**
   * What this feature shows the user and where (`surfaces.ts`), for the one Cockpit-wide line said
   * to the main agent — once per window, whichever features are loaded.
   */
  surfaces?: Surface[]
  /**
   * Every tool call that completed, any tool's — built-ins, MCP, other plugins'. Read-only: it hears
   * what a tool answered and cannot change it. A throw is logged and never reaches the call.
   */
  toolAfter?: (call: ToolCall) => Promise<void> | void
  sessionDeleted?: (sessionID: string) => Promise<void>
  /** Every event, as the host sends it: v1's `{ type, properties }`, v2's `{ type, data }`. */
  event?: (event: unknown) => Promise<void> | void
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
  const commands: CommandSpec[] = []
  for (const command of parts.flatMap((part) => part.commands ?? [])) {
    if (commands.some((each) => each.name === command.name))
      throw new Error(`command "/${command.name}" is registered by more than one cockpit feature`)
    commands.push(command)
  }
  const surfaces = parts.flatMap((part) => part.surfaces ?? [])
  const skills = [
    ...new Map(parts.flatMap((part) => part.skills ?? []).map((skill) => [skill.dir, skill])).values(),
  ]
  /** Only what some feature has: no features is no hooks at all, not hooks that do nothing. */
  const any = (key: keyof ServerParts) => parts.some((part) => part[key] !== undefined)
  return {
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(commands.length > 0 ? { commands } : {}),
    ...(surfaces.length > 0 ? { surfaces } : {}),
    ...(any("system")
      ? {
          system: async (sessionID: string | undefined) => {
            const lines: string[] = []
            for (const part of parts) lines.push(...((await part.system?.(sessionID)) ?? []))
            return lines
          },
        }
      : {}),
    ...(any("toolAfter")
      ? {
          /** One feature's failure does not keep the call from the next; the first is reported. */
          toolAfter: async (call: ToolCall) => {
            let failed: { error: unknown } | undefined
            for (const part of parts) {
              try {
                await part.toolAfter?.(call)
              } catch (error) {
                failed ??= { error }
              }
            }
            if (failed) throw failed.error
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
    ...(any("event")
      ? {
          event: async (event: unknown) => {
            for (const part of parts) await part.event?.(event)
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
        return result?.data as { parentID?: string; title?: string; agent?: string } | undefined
      },
      busy: async (id) => {
        const result = await client.session.status().catch(() => undefined)
        const all = result?.data as Record<string, { type?: string }> | undefined
        if (!all || typeof all !== "object") return undefined
        // v1 lists the sessions that are doing something; one it leaves out is idle.
        const type = all[id]?.type
        return type === "busy" || type === "retry"
      },
      notify: async (id, text) => {
        await client.session.promptAsync({
          path: { id },
          body: { parts: [{ type: "text", text, synthetic: true } as never] },
        })
      },
      children: async (id) => {
        const result = await client.session.children({ path: { id } }).catch(() => undefined)
        const list = result?.data as { id: string; title?: string; parentID?: string }[] | undefined
        return Array.isArray(list) ? list : []
      },
      messages: async (id) => {
        const result = await client.session.messages({ path: { id } }).catch(() => undefined)
        const list = result?.data as { info: unknown; parts: unknown[] }[] | undefined
        return Array.isArray(list) ? list : []
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

/**
 * What a v1 tool answered, as text. A built-in or plugin tool answers `{ title, output, metadata }`;
 * an MCP tool answers `{ content: [{ type: "text", text }] }` with no `output` at all, so reading
 * `output` alone missed every MCP call (docs/opencode/trail-server.md).
 */
export function v1ToolText(output: unknown): string {
  const answer = output as { output?: unknown; content?: unknown } | undefined
  if (typeof answer?.output === "string") return answer.output
  return contentText(answer?.content)
}

/** `[{ type: "text", text }, …]` as one string; anything that is not text is left out. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((part) =>
      typeof (part as { text?: unknown })?.text === "string" ? [(part as { text: string }).text] : [],
    )
    .join("\n")
}

/** The slice of OpenCode 1's config the `config` hook edits. */
interface V1Config {
  command?: Record<string, { template?: string; description?: string } & Record<string, unknown>>
  skills?: { paths?: string[] } & Record<string, unknown>
}

/**
 * Skills and commands into OpenCode 1's config, in memory. The hook gets the config already holding
 * the user's own entries: a command of the same name is merged *beneath* theirs, so what they wrote
 * wins. A folder already listed is not listed twice.
 */
export function addToV1Config(config: V1Config, parts: Pick<ServerParts, "skills" | "commands">): void {
  for (const command of parts.commands ?? []) {
    config.command ??= {}
    config.command[command.name] = {
      template: command.prompt,
      description: command.description,
      ...config.command[command.name],
    }
  }
  if (parts.skills?.length) {
    config.skills ??= {}
    const paths = config.skills.paths ?? []
    config.skills.paths = [
      ...paths,
      ...parts.skills.map((skill) => skill.dir).filter((dir) => !paths.includes(dir)),
    ]
  }
}

export function partsToV1Hooks(parts: ServerParts): Hooks {
  return {
    ...(parts.tools ? { tool: parts.tools } : {}),
    ...(parts.skills || parts.commands
      ? { config: async (config: V1Config) => addToV1Config(config, parts) }
      : {}),
    ...(parts.toolAfter
      ? {
          "tool.execute.after": async (input, output) => {
            await parts.toolAfter?.({
              sessionID: input.sessionID,
              tool: input.tool,
              callID: input.callID,
              args: input.args,
              output: v1ToolText(output),
            })
          },
        }
      : {}),
    ...(parts.system
      ? {
          "experimental.chat.system.transform": async (input, output) => {
            output.system.push(...((await parts.system?.(input.sessionID)) ?? []))
          },
        }
      : {}),
    ...(parts.sessionDeleted || parts.event
      ? {
          event: async ({ event }) => {
            if (event.type === "session.deleted") await parts.sessionDeleted?.(event.properties.info.id)
            await parts.event?.(event)
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

/**
 * A skill's folder as v2 takes it: name and description from the frontmatter, the text without it
 * (v1 strips it too). Undefined when the file is missing or names nothing — logged by the caller, never
 * thrown: no skill is worth the agent side.
 */
export function readSkill(spec: SkillSpec): V2Skill | undefined {
  const path = join(spec.dir, "SKILL.md")
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return undefined
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const field = (name: string) =>
    match?.[1]
      ?.split(/\r?\n/)
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2")
  const name = field("name")
  if (!name) return undefined
  const description = field("description")
  return {
    id: name,
    name,
    ...(description ? { description } : {}),
    path,
    content: match ? text.slice(match[0].length) : text,
  }
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
