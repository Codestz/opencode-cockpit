import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { formatLines, formatWait, header } from "../../core/format.ts"
import { abortable, type ToolKit } from "./shared.ts"

const WAIT = `Block until a condition holds in a background shell. This is the only correct way to wait:
never sleep and poll.

Conditions (combine freely; the first to happen wins, and the process exiting always ends the wait):
- pattern: regex matched against output lines (also matches an unfinished prompt line)
- port: something accepts TCP connections on this port
- idleSeconds: no output for this long (often means waiting for input or finished a step)
- exit: the process ends

Pattern matching includes output produced before this call in the current run, so "wait until ready"
succeeds immediately if it is already ready.`

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

export function shellWait(kit: ToolKit): ToolDefinition {
  const { client, resolve } = kit
  return tool({
    description: WAIT,
    args: {
      ...TARGET,
      pattern: z.string().optional(),
      ignoreCase: z.boolean().optional(),
      port: z.number().int().min(1).max(65535).optional(),
      host: z.string().optional(),
      idleSeconds: z.number().positive().optional(),
      exit: z.boolean().optional(),
      timeoutSeconds: z.number().positive().max(3600).default(300),
    },
    async execute(args, ctx) {
      const { id, note } = await resolve(args, ctx)
      const start = await client.call("shell.get", { id })
      const result = await abortable(
        ctx,
        client.call("shell.wait", {
          id,
          until: {
            pattern: args.pattern ?? undefined,
            ignoreCase: args.ignoreCase ?? undefined,
            port: args.port ?? undefined,
            host: args.host ?? undefined,
            exit: args.exit ?? undefined,
            idleMs: args.idleSeconds ? Math.round(args.idleSeconds * 1000) : undefined,
          },
          timeoutMs: Math.round((args.timeoutSeconds ?? 300) * 1000),
        }),
      )
      if (!result) return "wait cancelled"
      const newLines = result.info.lines.last - start.lines.last
      const page =
        newLines > 80
          ? await client.call("shell.read", { id, tail: 80 })
          : await client.call("shell.read", { id, after: start.lines.last, limit: 80 })
      const recent = page.lines
      if (newLines > 80)
        recent.unshift({
          n: start.lines.last,
          text: `… ${newLines - 80} earlier lines omitted (shell_read after=${start.lines.last})`,
        })
      return [
        note + formatWait(result, args.timeoutSeconds ?? 300),
        header(result.info),
        recent.length > 0 ? formatLines(recent) : "(no new output during the wait)",
        "</shell>",
        `cursor: ${result.info.lines.last}`,
      ].join("\n")
    },
  })
}
