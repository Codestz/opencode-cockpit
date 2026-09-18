import { type ToolContext, type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { CockpitClient } from "@opencode-cockpit/client"
import { RpcError } from "@opencode-cockpit/protocol"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { commandOf, filterShells, matchByName, type SessionFilter, type StatusFilter } from "./find.ts"
import { describeStatus, formatLines, formatRead, formatWait, header } from "./format.ts"
import { encodeKey, KEY_NAMES } from "./keys.ts"

export interface ToolDeps {
  client: CockpitClient
  /** Identifies this OpenCode instance so only it notifies the owning session. */
  instance: string
  /** Shells whose exit should not message the agent (it stopped them itself, or opted out). */
  quiet: Set<string>
  shellCommand(command: string): { command: string; args: string[] }
  env(): Record<string, string>
  /** Human title of an OpenCode session, for telling agents which session started a shell. */
  sessionTitle?(sessionID: string): Promise<string | undefined>
}

const z = tool.schema
/** Every per-shell tool takes either an id or a name. */
const TARGET = {
  id: z.string().optional().describe("Shell id from shell_start or shell_list, e.g. sh_ab12cd34"),
  name: z
    .string()
    .optional()
    .describe(
      'Instead of id: the shell\'s name (the description it was started with), e.g. "DB Monitoring". Partial names and command text also match.',
    ),
}

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

const READ = `Read a background shell's output.

- Default: the last lines of the log (colours removed, progress-bar redraws collapsed).
- after=<cursor>: only lines newer than a cursor returned by a previous call. Use this to follow output.
- grep=<regex>: only matching lines (e.g. "error|warn").
- view="screen": what the terminal shows right now. Use for full-screen programs (htop, vitest UI, prompts that redraw).`

const SEND = `Send input to a running background shell, then return the output it produced.

- text: literal characters. Set submit=true to press enter afterwards.
- keys: named keys pressed in order, e.g. ["ctrl+c"], ["down", "enter"]. Supported: ${KEY_NAMES.join(", ")}.`

const WATCH = `Keep an eye on a long-running shell and be told only when its health changes.

For processes that never exit (tsc --watch, vitest --watch, dev servers) this replaces re-reading
the log: you get one message when it breaks, and one when it is fixed, and nothing while it repeats
the same result.

- preset: a named rule ("auto" picks one from the command). Presets exist for tsc, vitest, jest,
  eslint, biome, cargo, go, gradle, pytest, vite, next, docker-compose and more.
- rule: your own patterns when no preset fits: done (a run ended), fail, ok, idleSeconds.
- off: stop watching.

A watched process that dies is reported as a failure, so a crashed dev server no longer goes
unnoticed.`

const WAIT = `Block until a condition holds in a background shell. This is the only correct way to wait:
never sleep and poll.

Conditions (combine freely; the first to happen wins, and the process exiting always ends the wait):
- pattern: regex matched against output lines (also matches an unfinished prompt line)
- port: something accepts TCP connections on this port
- idleSeconds: no output for this long (often means waiting for input or finished a step)
- exit: the process ends

Pattern matching includes output produced before this call in the current run, so "wait until ready"
succeeds immediately if it is already ready.`

export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  const { client } = deps

  const peek = async (info: ShellInfo, tail = 30) => {
    const current = await client.call("shell.get", { id: info.id })
    const page = await client.call("shell.read", { id: info.id, tail })
    return formatRead(current, page)
  }

  const sessionLabel = async (s: ShellInfo, ctx: ToolContext): Promise<string> => {
    const session = s.owner.session
    if (!session) return "started by the user"
    if (session === ctx.sessionID) return "this session"
    const title = await deps.sessionTitle?.(session).catch(() => undefined)
    return title ? `session "${title}"` : `another session (${session})`
  }

  /** Turns `{ id }` or `{ name }` into a shell id, or explains why it cannot. */
  const resolve = async (
    args: { id?: string | null; name?: string | null },
    ctx: ToolContext,
  ): Promise<{ id: string; note: string }> => {
    if (args.id) return { id: args.id, note: "" }
    if (!args.name) throw new Error("pass the shell's id or name")
    const shells = await client.call("shell.list", { owner: { project: ctx.directory } })
    const match = matchByName(shells, args.name)
    const describe = async (list: ShellInfo[]) =>
      (
        await Promise.all(
          list.map(
            async (s) =>
              `- ${s.id} "${s.title}" · ${s.status} · ${await sessionLabel(s, ctx)} · $ ${commandOf(s).slice(0, 80)}`,
          ),
        )
      ).join("\n")
    if (match.kind === "found") {
      const note =
        match.alsoMatched.length > 0
          ? `(name "${args.name}" also matched ${match.alsoMatched.length} finished shell${match.alsoMatched.length === 1 ? "" : "s"}; using the running one, ${match.shell.id})\n`
          : ""
      return { id: match.shell.id, note }
    }
    if (match.kind === "ambiguous") {
      throw new Error(
        `"${args.name}" matches several shells; pass one of these ids:\n${await describe(match.candidates)}`,
      )
    }
    throw new Error(
      match.available.length === 0
        ? `no shell matches "${args.name}": there are no shells in this project`
        : `no shell matches "${args.name}". Shells in this project:\n${await describe(match.available.slice(0, 15))}`,
    )
  }

  return {
    shell_start: tool({
      description: START,
      args: {
        command: z.string().min(1).describe("Command line, run by your shell (pipes, && and env vars work)"),
        description: z
          .string()
          .min(3)
          .describe("What this shell is for, 3-8 words, e.g. 'Next.js dev server'"),
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
          .union([z.boolean(), z.string()])
          .optional()
          .describe(
            'Watch this shell\'s health and message you only when it changes: true or "auto" picks a preset from the command, or name one (tsc, vitest, cargo…). For processes that never exit.',
          ),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Stop the process after this long. Only for commands expected to finish."),
      },
      async execute(args, ctx) {
        await askPermission(ctx, args.command)
        const shell = deps.shellCommand(args.command)
        const info = await client.call("shell.start", {
          command: shell.command,
          args: shell.args,
          cwd: args.workdir || ctx.directory,
          env: { ...deps.env(), ...args.env },
          title: args.description,
          owner: { project: ctx.directory, session: ctx.sessionID, instance: deps.instance },
          timeoutMs: args.timeoutSeconds ? Math.round(args.timeoutSeconds * 1000) : undefined,
          reuse: true,
        })
        if (args.notifyOnExit === false) deps.quiet.add(info.id)
        else deps.quiet.delete(info.id)
        ctx.metadata({ title: args.description, metadata: { shellId: info.id, command: args.command } })
        if (info.status === "failed") return `${header(info)}\n${describeStatus(info)}\n</shell>`

        const lines = [
          info.run > 1
            ? `Restarted ${info.id} (run ${info.run}): same command as an earlier finished shell in this session. Earlier output is above line ${info.lines.last}.`
            : `Started ${info.id}: ${args.command}`,
        ]

        if (args.watch) {
          const preset = typeof args.watch === "string" ? args.watch : "auto"
          await client
            .call("shell.watch", { id: info.id, preset })
            .then((watched) =>
              lines.push(
                `watching health (${watched.watch?.preset ?? "custom rule"}); changes will be messaged to you`,
              ),
            )
            .catch((err) =>
              lines.push(`could not watch: ${err instanceof Error ? err.message : String(err)}`),
            )
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
        lines.push(await peek(info))
        return lines.join("\n")
      },
    }),

    shell_read: tool({
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
    }),

    shell_send: tool({
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
    }),

    shell_wait: tool({
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
    }),

    shell_watch: tool({
      description: WATCH,
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
        const info = await client.call("shell.watch", {
          id,
          preset: args.preset ?? undefined,
          rule: args.rule
            ? {
                done: args.rule.done ?? undefined,
                fail: args.rule.fail ?? undefined,
                ok: args.rule.ok ?? undefined,
                ignoreCase: args.rule.ignoreCase ?? undefined,
                idleSeconds: args.rule.idleSeconds ?? undefined,
              }
            : undefined,
        })
        return `${note}watching ${info.id} (${info.watch?.preset ?? "custom rule"}). You will be messaged when its health changes; no need to poll.`
      },
    }),

    shell_list: tool({
      description: `List background shells in this project: name, status, which session started it, and the last output line.

Filter to find the one you need instead of reading them all:
- query: text in the name or command, e.g. "db" or "vitest"
- status: running, failed, finished
- session: this (started by you in this session), others (other sessions or the user)`,
      args: {
        query: z.string().optional().describe("Case-insensitive text in the shell name or command"),
        status: z.enum(["running", "failed", "finished", "any"]).default("any"),
        session: z.enum(["this", "others", "any"]).default("any"),
        all: z.boolean().default(false).describe("Include shells from other projects"),
      },
      async execute(args, ctx) {
        const everything = await client.call(
          "shell.list",
          args.all === true ? {} : { owner: { project: ctx.directory } },
        )
        const shells = filterShells(everything, {
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
              `${s.id}  ${s.status.padEnd(7)}  "${s.title}"${s.run > 1 ? ` (run ${s.run})` : ""} · ${await sessionLabel(s, ctx)}`,
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
    }),

    shell_stop: tool({
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
    }),

    shell_restart: tool({
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
    }),
  }
}

async function askPermission(ctx: ToolContext, command: string): Promise<void> {
  const words = command.trim().split(/\s+/)
  const prefix = words.slice(0, Math.min(2, words.length)).join(" ")
  await ctx.ask({
    permission: "bash",
    patterns: [command],
    always: [`${prefix} *`],
    metadata: { command, description: "background shell" },
  })
}

/** Resolves undefined when the tool call is aborted; the daemon keeps running the shell. */
function abortable<T>(ctx: ToolContext, promise: Promise<T>): Promise<T | undefined> {
  if (ctx.abort.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(undefined)
    ctx.abort.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => {
        ctx.abort.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (err) => {
        ctx.abort.removeEventListener("abort", onAbort)
        reject(err instanceof RpcError ? new Error(err.message) : err)
      },
    )
  })
}
