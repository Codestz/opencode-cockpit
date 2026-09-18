import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { commandOf, filterShells, type SessionFilter, type StatusFilter } from "../../core/find.ts"
import { describeStatus } from "../../core/format.ts"
import { kindOfShell, type ShellKind } from "../../core/kind.ts"
import type { ToolKit } from "./shared.ts"

const z = tool.schema
/**
 * Every per-shell tool takes an id or a name. Declared per tool file because exported zod schemas
 * cannot be named portably in generated declarations.
 */
const _TARGET = {
  id: z.string().optional().describe("Shell id from shell_start or shell_list, e.g. sh_ab12cd34"),
  name: z
    .string()
    .optional()
    .describe(
      'Instead of id: the shell\'s name (the description it was started with), e.g. "DB Monitoring". Partial names and command text also match.',
    ),
}

export function shellList(kit: ToolKit): ToolDefinition {
  const { client, config, sessionLabel } = kit
  // Kinds from config are filterable too, or classifying a command as "e2e" would be a dead end.
  const kinds = ["server", "tests", "build", "watcher", "task", ...Object.keys(config.kinds ?? {})]
  const kindValues: [string, ...string[]] = ["any", ...kinds]
  return tool({
    description: `List background shells in this project: name, status, which session started it, and the last output line.

  Filter to find the one you need instead of reading them all:
  - query: text in the name or command, e.g. "db" or "vitest"
  - status: running, failed, finished
  - session: this (started by you in this session), others (other sessions or the user)
  - kind: ${kinds.join(", ")} — derived from the command, so "which servers are up?" is one call`,
    args: {
      query: z.string().optional().describe("Case-insensitive text in the shell name or command"),
      status: z.enum(["running", "failed", "finished", "any"]).default("any"),
      session: z.enum(["this", "others", "any"]).default("any"),
      kind: z.enum(kindValues).default("any").describe("What the shell is, derived from its command"),
      all: z.boolean().default(false).describe("Include shells from other projects"),
    },
    async execute(args, ctx) {
      const everything = await client.call(
        "shell.list",
        args.all === true ? {} : { owner: { project: ctx.directory } },
      )
      const shells = filterShells(everything, {
        kind: (args.kind ?? "any") as ShellKind | "any",
        kinds: config.kinds,
        query: args.query ?? undefined,
        status: (args.status ?? "any") as StatusFilter,
        session: (args.session ?? "any") as SessionFilter,
        currentSession: ctx.sessionID,
      })
      if (everything.length === 0) return "No background shells."
      if (shells.length === 0)
        return `No shells match those filters (${everything.length} shell${everything.length === 1 ? "" : "s"} in total).`
      const rows = await Promise.all(
        shells.map(async (s) => {
          const last = await client.call("shell.read", { id: s.id, tail: 1 }).catch(() => undefined)
          const tail = last?.lines[0]?.text ?? ""
          const failure =
            s.summary && s.status !== "running" ? `\n    summary: ${s.summary.slice(0, 200)}` : ""
          const watch = s.watch
            ? `\n    watch: ${s.watch.preset ?? "custom"} · ${s.watch.status}${s.watch.summary ? ` · ${s.watch.summary.slice(0, 120)}` : ""}`
            : ""
          return [
            `${s.id}  ${s.status.padEnd(7)}  "${s.title}"${s.run > 1 ? ` (run ${s.run})` : ""} · ${kindOfShell(s, config.kinds)} · ${await sessionLabel(s, ctx)}`,
            `    $ ${commandOf(s).slice(0, 200)}${failure}`,
            `    ${describeStatus(s)}${watch}${tail ? `\n    last: ${tail.slice(0, 200)}` : ""}`,
          ].join("\n")
        }),
      )
      const hidden = everything.length - shells.length
      return (
        rows.join("\n") +
        (hidden > 0 ? `\n(${hidden} more shell${hidden === 1 ? "" : "s"} hidden by filters)` : "")
      )
    },
  })
}
