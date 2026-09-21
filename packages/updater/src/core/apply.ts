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
  const remedies: string[] = []
  for (const command of plan.commands) {
    const result = await io.opencode(command.args, command.cwd)
    if (result.status !== 0) {
      const why = failureReason(result.output)
      failures.push(
        `opencode ${command.args.join(" ")} failed${why ? `: ${why}` : ` (exit ${result.status})`}`,
      )
      const remedy = remedyFor(result.output)
      if (remedy && !remedies.includes(remedy)) remedies.push(remedy)
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
  // The remedy goes first: the retry command below it only works once the cause is gone.
  return {
    ...outcome,
    ok: false,
    problems: [...failures, ...outcome.problems],
    fixes: [...remedies, ...outcome.fixes],
  }
}

/** A terminal escape sequence, built from its code so no control character sits in a literal. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g")

/** Terminal escapes and spinner frames: `opencode plugin` draws for a person, not for a pipe. */
const plain = (output: string): string[] =>
  output
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[│┌└◆●◒◐◓◑\s]+/, "").trim())
    .filter(Boolean)

/**
 * The line that says why, out of what `opencode plugin` printed.
 *
 * Its output is a clack transcript ending in `└ Done` whether it worked or not, so "the last line" was
 * `└ Done` — seen on a real failure, where the reason sat two lines above: the last `■` line that is
 * more than a heading ("Install failed", "Could not install …").
 */
export function failureReason(output: string): string | undefined {
  const errors = output
    .replace(ANSI, "")
    .split(/\r?\n/)
    .filter((line) => line.includes("■"))
    .map((line) => line.replace(/^.*■\s*/, "").trim())
    .filter((line) => line && !/^Install failed$/i.test(line) && !/^Could not install\b/i.test(line))
  const home = process.env.HOME
  const reason =
    errors.at(-1) ??
    plain(output)
      .filter((l) => l !== "Done")
      .at(-1)
  return reason && home ? reason.split(home).join("~") : reason
}

/**
 * A cause this machine can fix, as the command that fixes it.
 *
 * npm's cache holding files the user does not own (usually from an old `sudo npm`) fails every
 * install that touches them, and `opencode plugin` installs through npm — seen on a real machine,
 * where one package failed and another installed fine.
 */
export function remedyFor(output: string): string | undefined {
  if (/EACCES/.test(output) && /[/\\]\.npm[/\\]/.test(output)) return 'sudo chown -R "$(whoami)" ~/.npm'
  return undefined
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
