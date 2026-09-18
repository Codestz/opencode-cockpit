import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { describeStatus } from "../../core/format.ts"
import type { ToolKit } from "./shared.ts"

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

export function shellStop(kit: ToolKit): ToolDefinition {
  const { client, deps, resolve } = kit
  return tool({
    description:
      "Stop a background shell (SIGTERM to its whole process group, then SIGKILL after a grace period). Set remove=true to also forget it.",
    args: {
      ...TARGET,
      remove: z.boolean().default(false),
      force: z.boolean().default(false).describe("Send SIGKILL immediately"),
    },
    async execute(args, ctx) {
      const { id, note } = await resolve(args, ctx)
      deps.quiet.add(id)
      const info = await client.call("shell.stop", {
        id,
        signal: args.force === true ? "SIGKILL" : "SIGTERM",
        graceMs: 3000,
      })
      if (args.remove === true) await client.call("shell.remove", { id })
      return `${note}${info.id} ${describeStatus(info)}${args.remove === true ? " and removed" : ""}`
    },
  })
}
