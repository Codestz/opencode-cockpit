/**
 * The plan: for every plugin, what runs, what is published, and exactly what an update would change.
 *
 * Plain data built before anything is written. The list and the review draw it, `opencode plugin`
 * carries it out, and `verify` checks disk against it afterwards — one description of the update,
 * so what was shown, what was done and what was checked cannot disagree.
 */

import type { ConfigEntry, ConfigFile } from "./configs.ts"
import { exactSpec, isNewer, type Spec } from "./spec.ts"

export type Source = "npm" | "file" | "internal"

export interface Plugin {
  name: string
  source: Source
  /** What is actually running; undefined when nothing says (a server-only plugin not yet read). */
  running?: string
  /** What to call it when its name is a path: the package name found there. */
  label?: string
}

/** What `api.plugins.list()` hands back, minus what the plan does not need. */
export interface Listed {
  id: string
  source: Source
  spec: string
}

export type State =
  /** A newer release is published. */
  | "update"
  /** Running the newest, but a spec would not stay there: `@latest`, a bare name, an older pin. */
  | "pin"
  | "current"
  /** The registry did not answer. */
  | "unknown"
  /** Built into OpenCode: shown, never touched. */
  | "internal"
  /** A path or URL: updated with git, not by this. */
  | "local"

export interface Command {
  cwd: string
  /** Arguments to `opencode`: always an exact version and always `-f`. */
  args: string[]
}

export interface Change {
  file: ConfigFile
  from: string
  to: string
}

export interface PluginPlan {
  name: string
  /** Shown in place of `name` when the name is a path. */
  label?: string
  source: Source
  running?: string
  published?: string
  state: State
  /** Every spec the configs carry for it, as written. */
  specs: string[]
  /** Some spec will not move on its own — the `⚠` in the list. */
  frozen: boolean
  changes: Change[]
  /** One per scope: `opencode plugin -f` rewrites every file of a scope at once. */
  commands: Command[]
  /** Cache directories to delete once the new version is installed. */
  remove: string[]
  /** Pre-selected in the list. */
  selected: boolean
}

export interface PlanInput {
  plugins: readonly Plugin[]
  entries: readonly ConfigEntry[]
  /** Newest on the registry; undefined when it did not answer. */
  published: ReadonlyMap<string, string | undefined>
  cacheDirs: ReadonlyMap<string, readonly string[]>
}

/**
 * A local plugin is named by its path — and the host reports `file:///x` for what the config wrote as
 * `/x`, so both are reduced to the bare path or the same plugin is listed twice.
 */
export const localName = (raw: string): string => raw.replace(/^file:\/\//, "").replace(/\/+$/, "")

const nameOf = (spec: Spec): string => (spec.kind === "npm" ? spec.name : localName(spec.raw))

/**
 * Every plugin, from what the host loaded and what the configs list.
 *
 * `api.plugins.list()` only knows TUI plugins, so a server-only plugin is found through the configs.
 * The CLI has no host at all and passes an empty list.
 */
export function collectPlugins(listed: readonly Listed[], entries: readonly ConfigEntry[]): Plugin[] {
  const byName = new Map<string, Plugin>()
  for (const item of listed) {
    if (item.source === "npm") {
      const spec = entries.find((e) => e.spec.raw === item.spec)?.spec
      const name = spec?.kind === "npm" ? spec.name : item.spec.replace(/(.)@[^@/]*$/, "$1")
      byName.set(name, { name, source: "npm" })
    } else {
      // A local plugin is named by its path, so the config entry for it matches below.
      const name = item.source === "file" ? localName(item.spec) : item.id
      byName.set(name, { name, source: item.source })
    }
  }
  for (const { spec } of entries) {
    const name = nameOf(spec)
    if (!byName.has(name)) byName.set(name, { name, source: spec.kind === "npm" ? "npm" : "file" })
  }
  return [...byName.values()]
}

/** A spec that would not keep the plugin at `published`. */
function needsChange(spec: Spec, published: string): boolean {
  if (spec.kind !== "npm") return false
  if (spec.pin.type !== "exact") return true
  return isNewer(published, spec.pin.version)
}

function classify(plugin: Plugin, specs: readonly Spec[], published: string | undefined): State {
  if (plugin.source === "internal") return "internal"
  if (plugin.source === "file") return "local"
  if (published === undefined) return "unknown"
  // Ahead of the registry — a pre-release, a local publish — is never "updated" backwards.
  if (plugin.running && isNewer(plugin.running, published)) return "current"
  if (plugin.running && isNewer(published, plugin.running)) return "update"
  const stale = specs.some((spec) => needsChange(spec, published))
  if (!plugin.running) return stale ? "update" : "current"
  return stale ? "pin" : "current"
}

function commandFor(file: ConfigFile, to: string): Command {
  return { cwd: file.cwd, args: ["plugin", to, "-f", ...(file.scope === "global" ? ["-g"] : [])] }
}

export function buildPlan(input: PlanInput): PluginPlan[] {
  const plans = input.plugins.map((plugin): PluginPlan => {
    const mine = input.entries.filter((entry) => nameOf(entry.spec) === plugin.name)
    const specs = mine.map((entry) => entry.spec)
    const published = input.published.get(plugin.name)
    const state = classify(plugin, specs, published)
    const acting = (state === "update" || state === "pin") && published !== undefined
    const to = published === undefined ? "" : exactSpec(plugin.name, published)

    const changes: Change[] = acting
      ? mine
          .filter((entry) => needsChange(entry.spec, published))
          .map((entry) => ({ file: entry.file, from: entry.spec.raw, to }))
      : []
    const commands: Command[] = []
    for (const change of changes) {
      if (change.file.owner !== "command") continue
      const command = commandFor(change.file, to)
      if (!commands.some((c) => c.cwd === command.cwd && c.args.join(" ") === command.args.join(" "))) {
        commands.push(command)
      }
    }
    const remove = acting
      ? (input.cacheDirs.get(plugin.name) ?? []).filter((dir) => !dir.endsWith(`/${to}`))
      : []

    return {
      name: plugin.name,
      ...(plugin.label === undefined ? {} : { label: plugin.label }),
      source: plugin.source,
      ...(plugin.running === undefined ? {} : { running: plugin.running }),
      ...(published === undefined ? {} : { published }),
      state,
      specs: specs.map((spec) => spec.raw),
      frozen: specs.some((spec) => spec.kind === "npm" && spec.pin.type !== "exact"),
      changes,
      commands,
      remove,
      selected: acting,
    }
  })
  return plans.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/**
 * Where a plugin sits in the list: lower comes first.
 *
 * What needs a decision, then what is fine, then what could not be checked, then what this screen
 * cannot act on. A failed registry check stays visible — it says `?` — without pushing rows that
 * have work in them down the list.
 */
export function rank(plan: PluginPlan): number {
  const order: Record<State, number> = { update: 1, pin: 1, current: 2, unknown: 3, internal: 4, local: 5 }
  // A frozen spec is the reason this screen exists: among the actionable rows, it leads.
  return order[plan.state] - (plan.selected && plan.frozen ? 1 : 0)
}
