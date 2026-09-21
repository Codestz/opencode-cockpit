/**
 * After the update: what disk actually says, against what the plan promised.
 *
 * Printed success is not evidence. `opencode plugin` reports "Installed" over an entry it left
 * alone, and `api.plugins.install` returns `{ ok: true }` for the same no-op — so the only thing
 * that counts is reading every file back.
 */

import type { ConfigEntry } from "./configs.ts"
import type { Command, PluginPlan } from "./plan.ts"

export interface Outcome {
  name: string
  ok: boolean
  /** What was confirmed on disk, in a few words each. */
  confirmed: string[]
  /** What is still wrong, one line each. */
  problems: string[]
  /** The exact commands that fix the problems, ready to copy. */
  fixes: string[]
}

export interface After {
  entries: readonly ConfigEntry[]
  /** The plugin's cache directories as they are now. */
  dirs: readonly string[]
}

const quote = (s: string): string => (/^[\w./@~:=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

export function commandLine(command: Command, global: boolean): string {
  const run = `opencode ${command.args.map(quote).join(" ")}`
  return global ? run : `cd ${quote(command.cwd)} && ${run}`
}

export function verify(plan: PluginPlan, after: After): Outcome {
  const confirmed: string[] = []
  const problems: string[] = []
  const fixes: string[] = []
  const fix = (line: string) => {
    if (!fixes.includes(line)) fixes.push(line)
  }

  let pinned = 0
  for (const change of plan.changes) {
    const now = after.entries
      .filter((e) => e.file.path === change.file.path)
      .filter((e) => (e.spec.kind === "npm" ? e.spec.name : e.spec.raw) === plan.name)
    if (now.length > 0 && now.every((e) => e.spec.raw === change.to)) {
      pinned++
      continue
    }
    const says = now.map((e) => e.spec.raw).filter((raw) => raw !== change.to)
    problems.push(
      now.length === 0
        ? `${change.file.path} no longer lists ${plan.name}`
        : `${change.file.path} still says ${says.join(", ")}`,
    )
    if (change.file.owner === "manual") {
      fix(`edit ${change.file.path}: "${change.from}" → "${change.to}"`)
    } else {
      const command = plan.commands.find((c) => c.cwd === change.file.cwd && c.args.includes(change.to))
      if (command) fix(commandLine(command, change.file.scope === "global"))
    }
  }
  if (pinned > 0) {
    const version = plan.published ?? ""
    confirmed.push(`${pinned} config${pinned === 1 ? "" : "s"} say @${version}`)
  }

  const left = plan.remove.filter((dir) => after.dirs.includes(dir))
  for (const dir of left) {
    problems.push(`${dir} is still there`)
    fix(`rm -rf ${quote(dir)}`)
  }
  const removed = plan.remove.length - left.length
  if (removed > 0) confirmed.push(`${removed} dir${removed === 1 ? "" : "s"} removed`)

  return { name: plan.name, ok: problems.length === 0, confirmed, problems, fixes }
}
