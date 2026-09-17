import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { createClient } from "./connect.ts"
import { describeStatus, formatLines } from "./tools/format.ts"
import { createTools } from "./tools/index.ts"

const GUIDANCE = `## Background shells (opencode-cockpit)
Long-running or interactive commands (dev servers, watchers, slow builds/tests, REPLs) go in shell_start, not bash with "&".
Block with shell_wait (pattern, port, idle, exit) instead of sleeping; follow output with shell_read(after=cursor).
You are messaged when a shell you started exits.`

const server: Plugin = async ({ client: opencode, directory }) => {
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

  // Wake the agent when a shell it owns ends on its own.
  cockpit.on("shell.exited", (info) => {
    if (info.owner.instance !== instance || !info.owner.session) return
    if (quiet.delete(info.id)) return
    void notifyExit(info).catch(() => {})
  })

  async function notifyExit(info: ShellInfo): Promise<void> {
    const session = info.owner.session as string
    const page = await cockpit.call("shell.read", { id: info.id, tail: 15 })
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
      shellCommand: (command) => ({ command: userShell, args: ["-c", command] }),
    }),

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(GUIDANCE)
      const running = await cockpit
        .call("shell.list", { owner: { project: directory }, includeExited: false })
        .catch(() => [] as ShellInfo[])
      if (running.length > 0) {
        output.system.push(
          `Background shells currently running in this project:\n${running
            .slice(0, 15)
            .map((s) => `- ${s.id} ${s.title} (${describeStatus(s)})`)
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

const plugin: PluginModule & { id: string } = { id: "opencode-cockpit", server }
export default plugin
