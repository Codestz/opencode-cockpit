/**
 * `opencode-cockpit update`: the updater for people whose installed copy is too old to contain it.
 *
 * Runs outside OpenCode under `npx`/`bunx`, both of which re-resolve `@latest` on every run — the
 * one thing OpenCode's own cache does not do. Every side effect comes through `Io`, so the whole
 * flow runs in a test against a filesystem made of an object.
 */

import { type ApplyIo, applyPlan, manualSteps, readiness } from "../core/apply.ts"
import { type GatherIo, gather } from "../core/gather.ts"
import type { Outcome } from "../core/verify.ts"
import { listRows, resultRows, reviewRows } from "../core/view/layout.ts"
import { fit, type Row } from "../core/view/rows.ts"
import { paint } from "./ansi.ts"

export interface Io extends ApplyIo, Omit<GatherIo, "worktree" | "listed"> {
  cwd: string
  /** The project's worktree root for `cwd`, if it is in one. */
  worktree(cwd: string): string | undefined
  /** Undefined when there is nobody to ask: not a terminal. */
  ask?: (question: string) => Promise<boolean>
  write(text: string): void
  width: number
  color: boolean
}

interface Args {
  only?: string
  dryRun: boolean
  yes: boolean
  help: boolean
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { dryRun: false, yes: false, help: false }
  const rest = argv[0] === "update" ? argv.slice(1) : argv
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--yes" || arg === "-y") args.yes = true
    else if (arg === "--help" || arg === "-h") args.help = true
    else if (arg === "--only") {
      const name = rest[++i]
      if (!name) return "--only needs a plugin name"
      args.only = name
    } else return `unknown argument: ${arg}`
  }
  return args
}

const HELP = `Usage: npx opencode-cockpit@latest update [options]

Shows every OpenCode plugin you have installed — what runs, what your config says, what is
published — and updates the ones that are behind, checking every file afterwards.

  --only <name>   update one plugin
  --dry-run       show the plan, write nothing
  --yes, -y       do not ask
`

export async function update(argv: readonly string[], io: Io): Promise<number> {
  const args = parseArgs(argv)
  const say = (rows: Row[]) => io.write(paint(rows, io.color))
  const line = (text: string, tone?: "muted" | "warning" | "removed") =>
    say([{ runs: fit([{ text, ...(tone ? { tone } : {}) }], io.width) }])
  if (typeof args === "string") {
    line(args, "removed")
    io.write(HELP)
    return 2
  }
  if (args.help) {
    io.write(HELP)
    return 0
  }

  const worktree = io.worktree(io.cwd)
  const found = await gather({
    env: io.env,
    home: io.home,
    disk: io.disk,
    fetchLatest: io.fetchLatest,
    ...(worktree ? { worktree } : {}),
  })
  for (const error of found.errors) line(`! ${error.path}: ${error.message}`, "removed")
  for (const warning of found.warnings) line(warning, "warning")
  const plans = found.plans

  if (plans.length === 0) {
    line("No plugins found in your OpenCode config.")
    return 0
  }
  if (args.only && !plans.some((p) => p.name === args.only)) {
    line(`${args.only} is not in your OpenCode config.`, "removed")
    return 2
  }

  io.write("\n")
  say(listRows(plans, io.width, undefined, io.home))
  const chosen = plans.filter((p) => p.selected && (!args.only || p.name === args.only))
  if (chosen.length === 0) {
    io.write("\n")
    // "Current" is a claim about the registry; a plugin it could not reach is not current, it is unknown.
    const unknown = plans.filter((p) => p.state === "unknown" && (!args.only || p.name === args.only))
    if (unknown.length > 0) {
      line(`Could not reach the registry for ${unknown.map((p) => p.name).join(", ")}.`, "warning")
      return 1
    }
    line(args.only ? `${args.only} is current.` : "Everything is current.")
    return 0
  }

  io.write("\n")
  say(reviewRows(chosen, io.width, io.home))
  io.write("\n")
  if (args.dryRun) {
    line("Dry run: nothing written.", "muted")
    return 0
  }

  const ready = await readiness(io, io.cwd)
  if (ready !== "ready") {
    line(
      ready === "missing"
        ? "No `opencode` on PATH, so nothing was written. To do it by hand:"
        : "This OpenCode's `plugin` command has no --force, so nothing was written. To do it by hand:",
      "warning",
    )
    for (const step of manualSteps(chosen)) line(`  ${step}`)
    return 1
  }

  const count = `${chosen.length} plugin${chosen.length === 1 ? "" : "s"}`
  if (!args.yes) {
    if (!io.ask) {
      line(`Not a terminal, so not asking. Rerun with --yes to update ${count}.`, "warning")
      return 1
    }
    if (!(await io.ask(`Update ${count}? [Y/n] `))) {
      line("Nothing written.", "muted")
      return 0
    }
  }

  const outcomes: Outcome[] = []
  for (const plan of chosen) outcomes.push(await applyPlan(plan, found, io))
  io.write("\n")
  say(resultRows(chosen, outcomes, io.width))
  io.write("\n")
  // Uncut, one per line: the rows above may clip at the terminal's edge, and a clipped command
  // cannot be pasted.
  const fixes = outcomes.flatMap((o) => o.fixes)
  if (fixes.length > 0) {
    line("To fix by hand:", "warning")
    for (const fix of fixes) io.write(`  ${fix}\n`)
    io.write("\n")
  }
  const done = chosen.filter((plan) => outcomes.find((o) => o.name === plan.name)?.ok)
  if (done.length > 0) {
    line(`Restart OpenCode to load ${done.map((p) => `${p.name} ${p.published}`).join(", ")}.`)
  }
  return outcomes.every((o) => o.ok) ? 0 : 1
}
