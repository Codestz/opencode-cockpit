import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { describeStatus, formatWait, header } from "../../core/format.ts"
import { abortable, askPermission, type ToolKit } from "./shared.ts"
import { watchArgs } from "./watch-args.ts"

const START = `Start a command in a background terminal (PTY) that keeps running while you continue working.

Use this instead of bash for anything long-running or interactive:
- dev servers, watchers (tsc --watch, vitest), local APIs, databases, tunnels
- builds or test suites that take more than ~30 seconds
- REPLs and prompts that need input later (use shell_send)

Do not append "&" or use nohup; the shell already runs in the background.

Readiness: pass waitFor to block until the process is actually ready, for example
waitFor={ port: 3000 } for a dev server or waitFor={ pattern: "compiled successfully" }.
Without waitFor the call returns after the first moment of quiet with the initial output.

You are notified automatically when the process exits (disable with notifyOnExit=false). Never
sleep and poll: use shell_wait to block on a condition, and shell_read(after=cursor) for new output.`

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

export function shellStart(kit: ToolKit): ToolDefinition {
  const { client, config, deps, peek } = kit
  return tool({
    description: START,
    args: {
      command: z.string().min(1).describe("Command line, run by your shell (pipes, && and env vars work)"),
      description: z.string().min(3).describe("What this shell is for, 3-8 words, e.g. 'Next.js dev server'"),
      workdir: z.string().optional().describe("Working directory; defaults to the project directory"),
      env: z.record(z.string(), z.string()).optional().describe("Extra environment variables"),
      waitFor: z
        .object({
          pattern: z.string().optional(),
          port: z.number().int().min(1).max(65535).optional(),
          idleSeconds: z.number().positive().optional(),
          exit: z.boolean().optional(),
          timeoutSeconds: z.number().positive().max(3600).default(120),
        })
        .optional()
        .describe("Block until ready. Same conditions as shell_wait."),
      notifyOnExit: z.boolean().default(true).describe("Message you when the process exits"),
      watch: z
        .union([
          z.boolean(),
          z.string(),
          z.object({
            done: z.string().optional().describe("A run finished, e.g. 'Found \\d+ errors'"),
            fail: z.string().optional(),
            ok: z.string().optional(),
            ignoreCase: z.boolean().optional(),
            idleSeconds: z.number().positive().optional(),
          }),
        ])
        .optional()
        .describe(
          'Watch this shell\'s health and message you only when it changes. true or "auto" picks a preset from the command (tsc, vitest, cargo…) and falls back to reporting the process dying; a name picks that preset; an object is your own rule, e.g. { done: "\\d+ (passed|failed)", fail: "\\d+ failed" }.',
        ),
      timeoutSeconds: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Stop the process after this long, busy or not. Good for bounded jobs and probes."),
      idleTimeoutSeconds: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Stop the process after this much silence. Never use it for dev servers, which are idle when healthy.",
        ),
      logFile: z
        .boolean()
        .default(false)
        .describe("Also write the clean log to a file, so old lines survive the in-memory buffer"),
    },
    async execute(args, ctx) {
      await askPermission(ctx, args.command)
      // Config supplies what the call left out; an explicit argument always wins.
      const defaults = config.defaults ?? {}
      const logFile = args.logFile ?? defaults.logFile ?? false
      const notifyOnExit = args.notifyOnExit ?? defaults.notifyOnExit ?? true
      const watch = args.watch ?? defaults.watch ?? (config.watch?.auto ? "auto" : undefined)
      const shell = deps.shellCommand(args.command)
      const info = await client.call("shell.start", {
        command: shell.command,
        args: shell.args,
        cwd: args.workdir || ctx.directory,
        env: { ...deps.env(), ...args.env },
        title: args.description,
        owner: { project: ctx.directory, session: ctx.sessionID, instance: deps.instance },
        timeoutMs: seconds(args.timeoutSeconds ?? defaults.timeoutSeconds),
        idleTimeoutMs: seconds(args.idleTimeoutSeconds ?? defaults.idleTimeoutSeconds),
        logFile: logFile === true,
        reuse: true,
      })
      if (notifyOnExit === false) deps.quiet.add(info.id)
      else deps.quiet.delete(info.id)
      ctx.metadata({ title: args.description, metadata: { shellId: info.id, command: args.command } })
      if (info.status === "failed") return `${header(info)}\n${describeStatus(info)}\n</shell>`

      const lines = [
        info.run > 1
          ? `Restarted ${info.id} (run ${info.run}): same command as an earlier finished shell in this session. Earlier output is above line ${info.lines.last}.`
          : `Started ${info.id}: ${args.command}`,
      ]

      if (watch) {
        const how =
          typeof watch === "object" ? { rule: watch } : watchArgs(watch === true ? "auto" : watch, config)
        await client
          .call("shell.watch", { id: info.id, ...how })
          .then((watched) => lines.push(describeWatch(watched)))
          .catch((err) => lines.push(`could not watch: ${err instanceof Error ? err.message : String(err)}`))
      }
      if (args.waitFor) {
        const { timeoutSeconds, idleSeconds, ...rest } = args.waitFor
        const result = await abortable(
          ctx,
          client.call("shell.wait", {
            id: info.id,
            until: {
              pattern: rest.pattern ?? undefined,
              port: rest.port ?? undefined,
              exit: rest.exit ?? undefined,
              idleMs: idleSeconds ? Math.round(idleSeconds * 1000) : undefined,
            },
            timeoutMs: Math.round((timeoutSeconds ?? 120) * 1000),
          }),
        ).catch((err) => {
          lines.push(
            `wait failed: ${err instanceof Error ? err.message : String(err)} (the shell is still running)`,
          )
          return undefined
        })
        if (result) lines.push(formatWait(result, timeoutSeconds ?? 120))
      } else {
        await abortable(
          ctx,
          client.call("shell.wait", { id: info.id, until: { idleMs: 700, exit: true }, timeoutMs: 2500 }),
        )
      }
      if (info.logFile) lines.push(`log file: ${info.logFile}`)
      lines.push(await peek(info))
      return lines.join("\n")
    },
  })
}

/** What was actually attached: a preset, your own rule, or plain crash reporting. */
function describeWatch(info: ShellInfo): string {
  const preset = info.watch?.preset
  if (preset === "exit")
    return "watching: no health patterns fit this command, so you will be messaged if it dies"
  return `watching health (${preset ?? "custom rule"}); changes will be messaged to you`
}

/** Milliseconds from an option in seconds, or undefined when unset. */
function seconds(value: number | null | undefined): number | undefined {
  return value ? Math.round(value * 1000) : undefined
}
