/** What a feature's agent half answers with, whichever OpenCode loads it, and how several combine. */

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { Log } from "../../log.ts"
import type { Surface } from "./surfaces.ts"

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
 * A tool call about to run, as `toolBefore` hears of it: what the model sent, before the tool reads
 * it — and before any permission it asks for. OpenCode 2 only.
 */
export interface ToolStart {
  sessionID: string
  tool: string
  callID: string
  /** What the model sent. */
  args: unknown
  agent?: string
  messageID?: string
}

/**
 * A permission OpenCode 2 is about to ask the person for, as `permission` hears of it: after config
 * left it at "ask" and before any request exists, so nothing has been drawn yet. Measured from 2.0.18's
 * own `Permission.evaluate` (docs/opencode/permissions.md). There is no request id yet — and no `save`,
 * OpenCode's own "always", which only the request it then makes carries.
 */
export interface PermissionAsk {
  sessionID: string
  /** The agent asking (`build`, `general`, `explore`…). */
  agent?: string
  /** As OpenCode 2 names it: `shell`, `edit`, `read`, `subagent`… */
  action: string
  /** What config was matched against: a shell request's commands, a path, a URL. */
  resources: string[]
  /** The tool call asking, when a tool asks: the `callID` its `toolBefore` came with. */
  callID?: string
  messageID?: string
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
  /**
   * Every tool call about to run, with what the model sent. OpenCode 2 only: v1's
   * `tool.execute.before` is not wired, since nothing here needs it there. Read-only, like `toolAfter`.
   */
  toolBefore?: (call: ToolStart) => Promise<void> | void
  /**
   * A permission about to be asked: "allow" answers it before OpenCode makes a request, so no prompt
   * is ever drawn; anything else leaves it to the person. OpenCode 2 only — v1's `permission.ask`
   * hook is declared and never called, so a feature answers there from the interface instead. A
   * throw, or a hook that never settles, must never cost the request: it is logged and left asked.
   */
  permission?: (request: PermissionAsk) => Promise<"allow" | undefined>
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
    ...(any("toolBefore")
      ? {
          toolBefore: async (call: ToolStart) => {
            let failed: { error: unknown } | undefined
            for (const part of parts) {
              try {
                await part.toolBefore?.(call)
              } catch (error) {
                failed ??= { error }
              }
            }
            if (failed) throw failed.error
          },
        }
      : {}),
    ...(any("permission")
      ? {
          /**
           * Allowed when any feature allows it: a feature can only answer for the person, never
           * refuse for them, so one saying nothing leaves the next free to answer. A failure is
           * reported only when nobody answered.
           */
          permission: async (request: PermissionAsk) => {
            let failed: { error: unknown } | undefined
            for (const part of parts) {
              try {
                if ((await part.permission?.(request)) === "allow") return "allow" as const
              } catch (error) {
                failed ??= { error }
              }
            }
            if (failed) throw failed.error
            return undefined
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
