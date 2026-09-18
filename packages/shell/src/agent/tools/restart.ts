import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { abortable, type ToolKit } from "./shared.ts"

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

export function shellRestart(kit: ToolKit): ToolDefinition {
  const { client, deps, peek, resolve } = kit
  return tool({
    description:
      "Restart a background shell with the same command. Keeps the id; output continues after a restart marker.",
    args: { ...TARGET },
    async execute(args, ctx) {
      const { id, note } = await resolve(args, ctx)
      const info = await client.call("shell.restart", { id })
      deps.quiet.delete(id)
      await abortable(
        ctx,
        client.call("shell.wait", { id: info.id, until: { idleMs: 700, exit: true }, timeoutMs: 2500 }),
      )
      return `${note}Restarted ${info.id} (run ${info.run})\n${await peek(info)}`
    },
  })
}
