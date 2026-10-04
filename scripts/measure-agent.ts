/**
 * What every bay's behaviour measurement shares (`packages/<bay>/measure/agent.ts`): a real OpenCode,
 * in a folder of its own, running one turn of a free model against a bay's server half, and what that
 * turn did — every tool call, Code Mode's inner calls included, and what it said.
 *
 * Isolation: OpenCode's config, state, data and cache and Cockpit's home are the run's own, and OpenCode
 * 2 runs `--standalone`, never against the user's background service. Needs the network, so the
 * measurements stay out of CI, like `AGENT=1 smoke:tui`.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface OpenCode {
  bin: string
  /** As `--version` prints it. */
  version: string
  v2: boolean
}

/** `OPENCODE`, or the `opencode` on PATH. Exits 2 when there is none. */
export function openCode(): OpenCode {
  const bin = process.env.OPENCODE ?? Bun.which("opencode")
  if (!bin) {
    console.error("opencode binary not found: set OPENCODE")
    process.exit(2)
  }
  const version = Bun.spawnSync([bin, "--version"]).stdout.toString().trim()
  return { bin, version, v2: version.replace(/^opencode\s+v?/, "").startsWith("2") }
}

/** `--flag value` from argv. */
export function flag(name: string): string | undefined {
  const args = process.argv.slice(2)
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

export interface Call {
  tool: string
  status?: string
  input?: unknown
}

/** Every tool call of a `--format json` run, Code Mode's inner calls included (v2 lists them on `execute`). */
export function toolCalls(stdout: string): Call[] {
  const out: Call[] = []
  for (const event of events(stdout)) {
    if (event.type !== "tool_use" || !event.part) continue
    const part = event.part as {
      tool: string
      state: {
        status?: string
        input?: unknown
        metadata?: { toolCalls?: unknown[]; metadata?: { toolCalls?: unknown[] } }
      }
    }
    out.push({ tool: part.tool, status: part.state.status, input: part.state.input })
    const inner = part.state.metadata?.toolCalls ?? part.state.metadata?.metadata?.toolCalls ?? []
    for (const call of inner as Call[]) out.push(call)
  }
  return out
}

function events(stdout: string): { type?: string; sessionID?: string; part?: Record<string, unknown> }[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

export interface Turn {
  calls: Call[]
  /** What the model wrote, joined. */
  said: string
  session?: string
  stdout: string
  stderr: string
}

export interface World {
  oc: OpenCode
  work: string
  project: string
  model: string
  env: Record<string, string | undefined>
}

/**
 * A world for one run: OpenCode configured with the bay's server half and the model, everything under
 * `work`. `extra` goes into the environment (a PATH with a fake `gh`, say).
 */
export async function world(
  oc: OpenCode,
  work: string,
  plugin: string,
  model: string,
  extra: Record<string, string> = {},
): Promise<World> {
  const project = join(work, "project")
  await Bun.write(
    join(work, "config", "opencode", "opencode.json"),
    JSON.stringify({ [oc.v2 ? "plugins" : "plugin"]: [plugin], model }),
  )
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(work, "config"),
    XDG_STATE_HOME: join(work, "state"),
    XDG_DATA_HOME: join(work, "data"),
    XDG_CACHE_HOME: join(work, "cache"),
    COCKPIT_HOME: join(work, "cockpit"),
    /** v2 places the session in $PWD's directory, not the spawn's cwd (trail-interface.md). */
    PWD: project,
    ...extra,
  }
  return { oc, work, project, model, env }
}

/** One `opencode run` turn, bounded; `session` continues that conversation. */
export function turn(at: World, prompt: string, session?: string): Turn {
  const cmd = [at.oc.bin, "run", ...(at.oc.v2 ? ["--standalone", "--auto"] : []), "-m", at.model]
  /** stdin must not be an open pipe, or `opencode run` waits forever (trail-server.md). */
  const result = Bun.spawnSync(
    [...cmd, ...(session ? ["--session", session] : []), "--format", "json", prompt],
    {
      cwd: at.project,
      env: at.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 300_000,
    },
  )
  const stdout = result.stdout.toString()
  const all = events(stdout)
  const said = all
    .filter((event) => event.type === "text")
    .map((event) => String((event.part as { text?: string } | undefined)?.text ?? ""))
    .join("\n")
  if (process.env.MEASURE_DEBUG) console.log(stdout.slice(-4000), result.stderr.toString().slice(-2000))
  return {
    calls: toolCalls(stdout),
    said,
    session: all.find((event) => typeof event.sessionID === "string")?.sessionID,
    stdout,
    stderr: result.stderr.toString(),
  }
}

/** Stops the Cockpit daemon a run spawned under its own home — and with it the shells it ran. */
export function stopDaemon(cockpitHome: string): void {
  try {
    const pid = Number(readFileSync(join(cockpitHome, "cockpitd.pid"), "utf8").trim())
    if (pid > 0) process.kill(pid, "SIGTERM")
  } catch {
    /** No daemon was started, or it has already gone. */
  }
}

/** A run's text, short, on one line. */
export const brief = (text: string, room = 200) => text.replace(/\s+/g, " ").slice(0, room)

/** Runs one measurement `runs` times, each tried again while it measured nothing; exits 0 when all passed. */
export async function measure<T extends { ok: boolean; measured: boolean; report: string[] }>(
  title: string,
  runs: number,
  once: (index: number) => Promise<T>,
  attempts = 3,
): Promise<never> {
  console.log(title)
  let passed = 0
  for (let i = 1; i <= runs; i++) {
    let outcome = await once(i)
    for (let attempt = 2; !outcome.measured && attempt <= attempts; attempt++) {
      console.log(`run ${i}: the model did nothing this measures — trying again (${attempt}/${attempts})`)
      for (const line of outcome.report) console.log(`  ${line}`)
      outcome = await once(i)
    }
    if (outcome.ok) passed++
    console.log(`run ${i}: ${outcome.ok ? "PASS" : outcome.measured ? "FAIL" : "NOTHING MEASURED"}`)
    for (const line of outcome.report) console.log(`  ${line}`)
  }
  console.log(`${passed} of ${runs} passed`)
  process.exit(passed === runs ? 0 : 1)
}
