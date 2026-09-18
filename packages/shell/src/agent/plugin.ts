import type { Hooks, Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { createClient } from "../connect.ts"
import { loadConfig } from "../core/config.ts"
import { describeStatus, formatLines } from "../core/format.ts"
import { createTools } from "./tools/index.ts"

const GUIDANCE = `## Background shells (opencode-cockpit)
Long-running or interactive commands (dev servers, watchers, slow builds/tests, REPLs) go in shell_start, not bash with "&".
Block with shell_wait (pattern, port, idle, exit) instead of sleeping; follow output with shell_read(after=cursor).
You are messaged when a shell you started exits.
For processes that never exit (tsc --watch, vitest --watch, dev servers), shell_watch reports only when their health changes — use it instead of re-reading their logs.`

export const SHELL_PACKAGE = "@opencode-cockpit/shell"

export interface ShellServerOptions {
  /** Package that loaded Shell, reported when a duplicate copy is skipped. */
  source?: string
}

/** Shell's server half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createShellServer({ source = SHELL_PACKAGE }: ShellServerOptions = {}): Plugin {
  return async (input, options) => {
    const claim = claimFeature(input, "shell", source)
    if (!claim.active) {
      // Logging through the server during plugin initialisation could wait on ourselves; defer it.
      setTimeout(() => {
        void input.client.app
          .log({
            body: {
              service: "opencode-cockpit",
              level: "warn",
              message: duplicateFeatureMessage("Shell", claim.owner, source),
            },
          })
          .catch(() => {})
      }, 0)
      return {}
    }
    const hooks = await shellHooks(input, options)
    const dispose = hooks.dispose
    return {
      ...hooks,
      dispose: async () => {
        claim.release()
        await dispose?.()
      },
    }
  }
}

async function shellHooks({ client: opencode, directory }: PluginInput, options?: unknown): Promise<Hooks> {
  const config = loadConfig(directory, options)
  const cockpit = createClient("opencode-cockpit/server")
  const instance = crypto.randomUUID()
  const quiet = new Set<string>()

  const userShell =
    process.env.SHELL && /(bash|zsh|fish|sh)$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/bash"
  const env = () => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("OPENCODE_")) out[k] = v
    return out
  }

  // Session titles rarely change; cache them so listing shells stays one round trip.
  const titles = new Map<string, { title: string | undefined; at: number }>()
  const sessionTitle = async (sessionID: string): Promise<string | undefined> => {
    const hit = titles.get(sessionID)
    if (hit && Date.now() - hit.at < 60_000) return hit.title
    const result = await opencode.session.get({ path: { id: sessionID } }).catch(() => undefined)
    const title = (result?.data as { title?: string } | undefined)?.title
    titles.set(sessionID, { title, at: Date.now() })
    return title
  }

  // Wake the agent when a shell it owns ends on its own.
  cockpit.on("shell.exited", (info) => {
    if (info.owner.instance !== instance || !info.owner.session) return
    if (quiet.delete(info.id) || config.notify?.exit === false) return
    void notifyExit(info).catch(() => {})
  })

  // A watcher's health changed. This is the whole point of watching: one message per change, never
  // per line, so a thousand identical recompiles cost nothing.
  cockpit.on("shell.watch", (event) => {
    const info = event.info
    if (config.notify?.watch === false) return
    if (info.owner.instance !== instance || !info.owner.session || event.current === "pending") return
    const text = [
      `<shell_health id="${info.id}" title="${info.title}" status="${event.current}">`,
      `${info.watch?.preset ?? "watch"}: ${event.previous} → ${event.current}`,
      event.summary ?? "",
      "</shell_health>",
      event.current === "ok"
        ? "Previously reported problems in this shell are resolved."
        : `Investigate with shell_read id=${info.id} if this affects your current task.`,
    ]
      .filter(Boolean)
      .join("\n")
    void opencode.session
      .promptAsync({
        path: { id: info.owner.session },
        body: { parts: [{ type: "text", text, synthetic: true } as never] },
      })
      .catch(() => {})
  })

  async function notifyExit(info: ShellInfo): Promise<void> {
    const session = info.owner.session as string
    const page = await cockpit.call("shell.read", { id: info.id, tail: config.notify?.tailLines ?? 15 })
    const failed =
      info.status === "failed" ||
      (info.status === "exited" && info.exitCode !== 0) ||
      info.status === "killed"
    const text = [
      `<shell_exited id="${info.id}" title="${info.title}">`,
      describeStatus(info),
      page.lines.length > 0 ? `last output:\n${formatLines(page.lines)}` : "(no output)",
      "</shell_exited>",
      failed
        ? `Investigate with shell_read id=${info.id} grep="error|fail" if the failure matters to the task.`
        : `Full output: shell_read id=${info.id}.`,
    ].join("\n")
    await opencode.session.promptAsync({
      path: { id: session },
      body: { parts: [{ type: "text", text, synthetic: true } as never] },
    })
  }

  return {
    tool: createTools({
      client: cockpit,
      instance,
      quiet,
      env,
      config,
      sessionTitle,
      shellCommand: (command) => ({ command: userShell, args: ["-c", command] }),
    }),

    "experimental.chat.system.transform": async (input, output) => {
      if (config.guidance !== false) output.system.push(GUIDANCE)
      const listLimit = config.listRunningShells ?? 15
      if (listLimit <= 0) return
      const running = await cockpit
        .call("shell.list", { owner: { project: directory }, includeExited: false })
        .catch(() => [] as ShellInfo[])
      if (running.length > 0) {
        output.system.push(
          `Background shells currently running in this project:\n${running
            .slice(0, listLimit)
            .map((s) => {
              const from = !s.owner.session
                ? ", started by the user"
                : s.owner.session === input.sessionID
                  ? ""
                  : ", another session"
              const health = s.watch ? `, ${s.watch.preset ?? "watch"}: ${s.watch.status}` : ""
              return `- ${s.id} "${s.title}" (${describeStatus(s)}${from}${health})`
            })
            .join("\n")}`,
        )
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const sessionID = event.properties.info.id
      const owned = await cockpit
        .call("shell.list", { owner: { session: sessionID } })
        .catch(() => [] as ShellInfo[])
      for (const shell of owned) {
        quiet.add(shell.id)
        await cockpit.call("shell.remove", { id: shell.id }).catch(() => {})
      }
    },

    dispose: async () => {
      cockpit.close()
    },
  }
}

const plugin: PluginModule & { id: string } = { id: "opencode-cockpit.shell", server: createShellServer() }
export default plugin
