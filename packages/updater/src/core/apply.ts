/**
 * Carrying a plan out: `opencode plugin -f` for each scope, then the sweep, then reading it all back.
 * The same steps from the CLI and from the dialog.
 */

import { cacheDirsFor } from "./cache.ts"
import { type ConfigFile, readConfigs } from "./configs.ts"
import type { Disk } from "./disk.ts"
import type { PluginPlan } from "./plan.ts"
import { commandLine, type Outcome, verify } from "./verify.ts"

export interface ApplyIo {
  disk: Disk
  /** `status` is null when there is no `opencode` to run. */
  opencode(args: readonly string[], cwd: string): Promise<{ status: number | null; output: string }>
  remove(dir: string): void
}

export type Readiness = "ready" | "missing" | "no-force"

/** Whether this machine's `opencode` can do the writing. Nothing is written when it cannot. */
export async function readiness(io: Pick<ApplyIo, "opencode">, cwd: string): Promise<Readiness> {
  const help = await io.opencode(["plugin", "--help"], cwd)
  if (help.status === null) return "missing"
  return help.output.includes("--force") ? "ready" : "no-force"
}

export async function applyPlan(
  plan: PluginPlan,
  where: { root: string; files: readonly ConfigFile[] },
  io: ApplyIo,
): Promise<Outcome> {
  const failures: string[] = []
  for (const command of plan.commands) {
    const result = await io.opencode(command.args, command.cwd)
    if (result.status !== 0) {
      const last = result.output.trim().split("\n").pop() ?? ""
      failures.push(`opencode ${command.args.join(" ")} exited ${result.status}${last ? `: ${last}` : ""}`)
    }
  }
  // A failed install keeps the old copy: removing it would leave nothing that runs.
  if (failures.length === 0) {
    for (const dir of plan.remove) io.remove(dir)
  }
  // Directories kept on purpose are not a problem to report.
  const outcome = verify(failures.length === 0 ? plan : { ...plan, remove: [] }, {
    entries: readConfigs(where.files, io.disk).entries,
    dirs: cacheDirsFor(io.disk, where.root, plan.name),
  })
  if (failures.length === 0) return outcome
  return { ...outcome, ok: false, problems: [...failures, ...outcome.problems] }
}

/** Every step of the plans as lines a person can run, for when nothing may be run for them. */
export function manualSteps(plans: readonly PluginPlan[]): string[] {
  const steps: string[] = []
  for (const plan of plans) {
    for (const command of plan.commands) steps.push(commandLine(command, command.args.includes("-g")))
    for (const change of plan.changes) {
      if (change.file.owner === "manual")
        steps.push(`edit ${change.file.path}: "${change.from}" → "${change.to}"`)
    }
    for (const dir of plan.remove) steps.push(`rm -rf '${dir}'`)
  }
  return steps
}
