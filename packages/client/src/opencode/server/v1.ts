import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { type Log, silentLog } from "../../log.ts"
import type { ServerHost, ServerParts } from "./parts.ts"

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
export function contentText(content: unknown): string {
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
