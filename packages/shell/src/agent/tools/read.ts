import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { describeStatus, formatRead, header } from "../../core/format.ts"
import type { ToolKit } from "./shared.ts"

const READ = `Read a background shell's output.

- Default: the last lines of the log (colours removed, progress-bar redraws collapsed).
- after=<cursor>: only lines newer than a cursor returned by a previous call. Use this to follow output.
- grep=<regex>: only matching lines (e.g. "error|warn").
- view="screen": what the terminal shows right now. Use for full-screen programs (htop, vitest UI, prompts that redraw).`

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

export function shellRead(kit: ToolKit): ToolDefinition {
  const { client, resolve } = kit
  return tool({
    description: READ,
    args: {
      ...TARGET,
      view: z.enum(["log", "screen"]).default("log"),
      after: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Cursor from a previous result; returns only newer lines"),
      tail: z
        .number()
        .int()
        .positive()
        .max(2000)
        .default(60)
        .describe("Lines from the end when no cursor is given"),
      grep: z.string().optional().describe("Regex filter"),
      ignoreCase: z.boolean().default(false),
      limit: z.number().int().positive().max(2000).default(300),
    },
    async execute(args, ctx) {
      const { id, note } = await resolve(args, ctx)
      const info = await client.call("shell.get", { id })
      if (args.view === "screen") {
        const screen = await client.call("shell.screen", { id })
        return [
          `${note}${header(info)}`,
          `status: ${describeStatus(info)}`,
          `screen ${screen.cols}x${screen.rows}:`,
          screen.text || "(blank)",
          "</shell>",
        ].join("\n")
      }
      const page = await client.call("shell.read", {
        id,
        after: args.after ?? undefined,
        tail: args.tail ?? 60,
        grep: args.grep ?? undefined,
        ignoreCase: args.ignoreCase ?? false,
        limit: args.limit ?? 300,
      })
      return note + formatRead(info, page, args.after != null ? "(no new output)" : "(no output yet)")
    },
  })
}
