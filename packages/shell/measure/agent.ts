#!/usr/bin/env bun
/**
 * Shell's measurement: whether the guidance changes what a real agent does, not only what it is told.
 * In a project whose `package.json` has a `dev` script, two conversations ask for the same thing —
 * "start the dev server and check it responds" — and neither prompt says a word about shells:
 *
 *   1. the first must start it with shell_start, never with bash and "&";
 *   2. the second, with that server still running (`lifecycle.onExit: "keep"` lets it outlive the
 *      first run), must not start a second one.
 *
 * A run whose first turn never started the server at all measured nothing, and is tried again.
 *
 *   bun packages/shell/measure/agent.ts                          OpenCode on PATH, this checkout
 *   OPENCODE=~/.opencode/bin/opencodeold bun packages/shell/measure/agent.ts
 *   bun packages/shell/measure/agent.ts --plugin <dir> --runs 3 --model <id> --keep
 *
 * `--plugin` is the server half: a package directory, by default this checkout's `packages/shell`,
 * built (`bun run build`). Exits 0 when every run passed, 1 otherwise.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  brief,
  type Call,
  flag,
  measure,
  openCode,
  stopDaemon,
  turn,
  world,
} from "../../../scripts/measure-agent.ts"

const oc = openCode()
const plugin = resolve(flag("--plugin") ?? join(import.meta.dir, ".."))
const runs = Number(flag("--runs")) || 1
const model = flag("--model") ?? "opencode/space-bunny-free"
const keep = process.argv.includes("--keep")

export const PROMPT = "Start the dev server and check it responds."

/** The dev server being run, however it is spelled — and not `cat server.js`, which only reads it. */
const DEV = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?dev\b|\b(bun|node)\s+(run\s+)?server\.js/
const commandOf = (call: Call) => String((call.input as { command?: unknown } | undefined)?.command ?? "")
/** OpenCode 1's built-in is `bash`, OpenCode 2's `shell`. */
const viaBash = (calls: Call[]) =>
  calls.filter((c) => (c.tool === "bash" || c.tool === "shell") && DEV.test(commandOf(c)))
const viaShell = (calls: Call[]) =>
  calls.filter((c) => c.tool === "shell_start" && c.status === "completed" && DEV.test(commandOf(c)))
const listed = (calls: Call[]) => calls.some((c) => c.tool === "shell_list" && c.status === "completed")

async function once(index: number) {
  const work = mkdtempSync(`/tmp/ck-shell-${index}-`)
  const port = 40_000 + Math.floor(Math.random() * 9_000)
  const at = await world(oc, work, plugin, model)
  try {
    await Bun.write(
      join(at.project, "package.json"),
      JSON.stringify({ name: "web", private: true, scripts: { dev: "bun server.js" } }, null, 2),
    )
    await Bun.write(
      join(at.project, "server.js"),
      `Bun.serve({ port: ${port}, fetch: () => new Response("ok") })\nconsole.log("Ready on http://localhost:${port}")\n`,
    )
    /** Cockpit's own file, outside the project: the first run's shells outlive it, for the second. */
    await Bun.write(
      join(work, "config", "opencode-cockpit", "config.json"),
      JSON.stringify({ shell: { lifecycle: { onExit: "keep" } } }),
    )

    const first = turn(at, PROMPT)
    const started = viaShell(first.calls)
    const bashed = viaBash(first.calls)
    const report = [
      `1st: shell_start ${started.length} ${started.map((c) => JSON.stringify(c.input)).join(" ")}`,
      `1st: bash running it ${bashed.length} ${bashed.map((c) => commandOf(c)).join(" | ")}`,
      `1st said: ${brief(first.said)}`,
    ]
    if (started.length === 0 && bashed.length === 0) return { ok: false, measured: false, report }
    if (started.length === 0 || bashed.length > 0) return { ok: false, measured: true, report }

    /** A new conversation, the server still running. */
    const second = turn(at, PROMPT)
    const again = viaShell(second.calls)
    const againBash = viaBash(second.calls)
    report.push(
      `2nd: shell_list ${listed(second.calls)}  shell_start ${again.length}  bash running it ${againBash.length} ${againBash.map((c) => commandOf(c)).join(" | ")}`,
      `2nd said: ${brief(second.said)}`,
    )
    if (second.calls.length === 0) return { ok: false, measured: false, report }
    return { ok: again.length === 0 && againBash.length === 0, measured: true, report }
  } finally {
    stopDaemon(at.env.COCKPIT_HOME as string)
    if (!keep) rmSync(work, { recursive: true, force: true })
    else console.log(`kept ${work}`)
  }
}

await measure(
  `Shell measurement: ${oc.version} (${oc.bin}), plugin ${plugin}, ${model}, ${runs} run(s)`,
  runs,
  once,
)
