import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ToolKit } from "./shared.ts"
import { asWatchRule, watchArgs } from "./watch-args.ts"

const WATCH = `Keep an eye on a long-running shell and be told only when its health changes.

For processes that never exit (tsc --watch, vitest --watch, dev servers) this replaces re-reading
the log: you get one message when it breaks, and one when it is fixed, and nothing while it repeats
the same result.

- preset: a named rule ("auto" picks one from the command, and falls back to reporting the process
  dying when no patterns fit). Presets exist for tsc, vitest, jest, eslint, biome, cargo, go,
  gradle, pytest, vite, next, docker-compose and more; "exit" watches only for the process dying,
  which is how you get crash detection for a command that prints nothing useful.
- rule: your own patterns when no preset fits: done (a run ended), fail, ok, idleSeconds.
- off: stop watching.

A watched process that dies is reported as a failure, so a crashed dev server no longer goes
unnoticed.`

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

export function shellWatch(kit: ToolKit): ToolDefinition {
  const { client, config, resolve } = kit
  // Presets from config are worth advertising: the agent cannot guess a name it has never seen.
  const named = Object.keys(config.watch?.presets ?? {})
  return tool({
    description: named.length > 0 ? `${WATCH}\n\nPresets from this project: ${named.join(", ")}.` : WATCH,
    args: {
      ...TARGET,
      preset: z.string().optional().describe('Preset name, or "auto" to pick one from the command'),
      rule: z
        .object({
          done: z.string().optional().describe("A run finished, e.g. 'Found \\d+ errors'"),
          fail: z.string().optional(),
          ok: z.string().optional(),
          ignoreCase: z.boolean().optional(),
          idleSeconds: z
            .number()
            .positive()
            .optional()
            .describe("Without `done`: treat this much silence as the end of a run"),
        })
        .optional()
        .describe("Custom patterns; use when no preset fits"),
      off: z.boolean().default(false).describe("Stop watching this shell"),
    },
    async execute(args, ctx) {
      const { id, note } = await resolve(args, ctx)
      if (args.off === true) {
        const stopped = await client.call("shell.unwatch", { id })
        return `${note}stopped watching ${stopped.id}`
      }
      // A preset defined in config travels as an explicit rule; the daemon knows only the built-ins.
      // Both arguments absorb a rule written as JSON, rather than failing on a preset name nobody has.
      const chosen = args.preset ? watchArgs(args.preset, config) : {}
      const rule = asWatchRule(args.rule) ?? chosen.rule
      const info = await client.call("shell.watch", {
        id,
        preset: rule ? undefined : chosen.preset,
        rule,
      })
      return `${note}watching ${info.id} (${info.watch?.preset ?? "custom rule"}). You will be messaged when its health changes; no need to poll.`
    },
  })
}
