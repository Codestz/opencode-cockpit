import type { ToolContext } from "@opencode-ai/plugin"
import type { CockpitClient } from "@opencode-cockpit/client"
import { RpcError } from "@opencode-cockpit/protocol"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import type { CockpitConfig } from "../../core/config.ts"
import { commandOf, matchByName } from "../../core/find.ts"
import { formatRead } from "../../core/format.ts"

export interface ToolDeps {
  client: CockpitClient
  /** Identifies this OpenCode instance so only it notifies the owning session. */
  instance: string
  /** Shells whose exit should not message the agent (it stopped them itself, or opted out). */
  quiet: Set<string>
  shellCommand(command: string): { command: string; args: string[] }
  env(): Record<string, string>
  /** Settings that shape defaults, kinds and watch presets. */
  config?: CockpitConfig
  /** Human title of an OpenCode session, for telling agents which session started a shell. */
  sessionTitle?(sessionID: string): Promise<string | undefined>
  /**
   * The conversation a session belongs to: a subagent's session resolves to the one you are in.
   *
   * Optional, and falling back to the id given is the honest default — a host that cannot say
   * leaves shells where they were, which is what happened before this existed.
   */
  rootSession?(sessionID: string | undefined): Promise<string | undefined>
}

/** What every tool shares: the client, name resolution, permission prompts and abort handling. */
export interface ToolKit {
  deps: ToolDeps
  /** Settings from ~/.config/opencode-cockpit/config.json, .cockpit.json and plugin options. */
  config: CockpitConfig
  client: CockpitClient
  peek(info: ShellInfo, tail?: number): Promise<string>
  sessionLabel(shell: ShellInfo, ctx: ToolContext): Promise<string>
  resolve(
    args: { id?: string | null; name?: string | null },
    ctx: ToolContext,
  ): Promise<{ id: string; note: string }>
}

export function createToolKit(deps: ToolDeps): ToolKit {
  const { client } = deps

  const peek = async (info: ShellInfo, tail = 30) => {
    const current = await client.call("shell.get", { id: info.id })
    const page = await client.call("shell.read", { id: info.id, tail })
    return formatRead(current, page)
  }

  const sessionLabel = async (s: ShellInfo, ctx: ToolContext): Promise<string> => {
    const session = s.owner.session
    if (!session) return "started by the user"
    if (
      session === (await deps.rootSession?.(ctx.sessionID).catch(() => undefined)) ||
      session === ctx.sessionID
    )
      return "this session"
    const title = await deps.sessionTitle?.(session).catch(() => undefined)
    return title ? `session "${title}"` : `another session (${session})`
  }

  /** Turns `{ id }` or `{ name }` into a shell id, or explains why it cannot. */
  const resolve = async (
    args: { id?: string | null; name?: string | null },
    ctx: ToolContext,
  ): Promise<{ id: string; note: string }> => {
    if (args.id) return { id: args.id, note: "" }
    if (!args.name) throw new Error("pass the shell's id or name")
    const shells = await client.call("shell.list", { owner: { project: ctx.directory } })
    const match = matchByName(shells, args.name)
    const describe = async (list: ShellInfo[]) =>
      (
        await Promise.all(
          list.map(
            async (s) =>
              `- ${s.id} "${s.title}" · ${s.status} · ${await sessionLabel(s, ctx)} · $ ${commandOf(s).slice(0, 80)}`,
          ),
        )
      ).join("\n")
    if (match.kind === "found") {
      const note =
        match.alsoMatched.length > 0
          ? `(name "${args.name}" also matched ${match.alsoMatched.length} finished shell${match.alsoMatched.length === 1 ? "" : "s"}; using the running one, ${match.shell.id})\n`
          : ""
      return { id: match.shell.id, note }
    }
    if (match.kind === "ambiguous") {
      throw new Error(
        `"${args.name}" matches several shells; pass one of these ids:\n${await describe(match.candidates)}`,
      )
    }
    throw new Error(
      match.available.length === 0
        ? `no shell matches "${args.name}": there are no shells in this project`
        : `no shell matches "${args.name}". Shells in this project:\n${await describe(match.available.slice(0, 15))}`,
    )
  }

  return { deps, config: deps.config ?? {}, client, peek, sessionLabel, resolve }
}

export async function askPermission(ctx: ToolContext, command: string): Promise<void> {
  const words = command.trim().split(/\s+/)
  const prefix = words.slice(0, Math.min(2, words.length)).join(" ")
  await ctx.ask({
    permission: "bash",
    patterns: [command],
    always: [`${prefix} *`],
    metadata: { command, description: "background shell" },
  })
}

/** Resolves undefined when the tool call is aborted; the daemon keeps running the shell. */
export function abortable<T>(ctx: ToolContext, promise: Promise<T>): Promise<T | undefined> {
  if (ctx.abort.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(undefined)
    ctx.abort.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => {
        ctx.abort.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (err) => {
        ctx.abort.removeEventListener("abort", onAbort)
        reject(err instanceof RpcError ? new Error(err.message) : err)
      },
    )
  })
}
