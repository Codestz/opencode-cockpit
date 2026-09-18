import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { formatRead } from "../../core/format.ts"
import { encodeKey, KEY_NAMES } from "./keys.ts"
import { abortable, type ToolKit } from "./shared.ts"

const SEND = `Send input to a running background shell, then return the output it produced.

- text: literal characters. Set submit=true to press enter afterwards.
- keys: named keys pressed in order, e.g. ["ctrl+c"], ["down", "enter"]. Supported: ${KEY_NAMES.join(", ")}.`

const z = tool.schema
/**
 * Every per-shell tool takes an id or a name. Declared per tool file because exported zod schemas
 * cannot be named portably in generated declarations.
 */
const TARGET = {
  id: z.string().optional().describe("Shell id from shell_start or shell_list, e.g. sh_ab12cd34"),
  name: z
    .string()
    .optional()
    .describe(
      'Instead of id: the shell\'s name (the description it was started with), e.g. "DB Monitoring". Partial names and command text also match.',
    ),
}

export function shellSend(kit: ToolKit): ToolDefinition {
  const { client, resolve } = kit
  return tool({
    description: SEND,
    args: {
      ...TARGET,
      text: z.string().optional(),
      keys: z.array(z.string()).optional(),
      submit: z.boolean().default(false).describe("Press enter after text"),
      waitSeconds: z.number().min(0).max(30).default(1).describe("Max time to collect the response"),
    },
    async execute(args, ctx) {
      if (!args.text && !args.keys?.length) throw new Error("provide text and/or keys")
      let data = args.text ?? ""
      for (const key of args.keys ?? []) data += encodeKey(key)
      if (args.submit === true) data += "\r"
      const { id, note } = await resolve(args, ctx)
      const before = await client.call("shell.get", { id })
      await client.call("shell.write", { id, data })
      const waitSeconds = args.waitSeconds ?? 1
      if (waitSeconds > 0) {
        await abortable(
          ctx,
          client.call("shell.wait", {
            id,
            until: { idleMs: 400, exit: true },
            timeoutMs: Math.round(waitSeconds * 1000),
            after: before.lines.last,
          }),
        )
      }
      const info = await client.call("shell.get", { id })
      const page = await client.call("shell.read", { id, after: before.lines.last, limit: 300 })
      return (
        note +
        formatRead(
          info,
          page,
          "(no new output lines; if this is a full-screen program use shell_read view=screen)",
        )
      )
    },
  })
}
