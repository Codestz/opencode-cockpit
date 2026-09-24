/**
 * What `opencode-cockpit doctor` concludes, from facts gathered elsewhere (`gather.ts`). Pure: every
 * check takes what was found and says what it means — so each one is tested against a machine made
 * of an object, and a check never touches the disk it is judging.
 *
 * Every problem carries the command that fixes it, for the OpenCode that is actually installed: the
 * point is not a report, it is the next step (docs/roadmap/doctor.md).
 */

import { isNewer, type Spec } from "../core/spec.ts"

export type State = "ok" | "info" | "warn" | "fail"

export interface Check {
  title: string
  state: State
  summary: string
  /** Supporting lines, shown under the summary. */
  detail?: string[]
  /** What to run or change, exactly. */
  fix?: string[]
}

/** The packages Cockpit ships, and which halves each has. */
export const BUNDLE = "opencode-cockpit"
export const BAYS = ["shell", "review", "status", "updater"] as const
export type Bay = (typeof BAYS)[number]
/** Bays with an agent half — the rest are interface only. */
const SERVER_BAYS: readonly string[] = ["shell", "review"]

/** Where a config file sits in OpenCode's split: agent plugins or interface plugins. */
export type Half = "server" | "tui"

export interface Entry {
  /** The config file it was found in. */
  file: string
  half: Half
  /** As written. */
  raw: string
  spec: Spec
  /** `opencode-cockpit`, `@opencode-cockpit/shell`…; a local path is named by its own package.json. */
  name: string | undefined
}

export interface Facts {
  opencode: { version: string | undefined; major: number | undefined }
  entries: Entry[]
  configErrors: { path: string; message: string }[]
  /** Newest published version per package name, when the registry answered. */
  latest: Map<string, string | undefined>
  /** Local entries whose directory has its own OpenTUI: a checkout rather than an install. */
  checkouts: Set<string>
  log: LogFacts
  daemon: DaemonFacts
  env: { git: boolean; ps: boolean; homeWritable: boolean; home: string }
  settings: SettingsFacts
}

export interface LogFacts {
  file: string
  exists: boolean
  /** Newest start line per half and entry. */
  starts: {
    scope: string
    entry: string
    opencode?: number
    opencodeVersion?: string
    cockpit?: string
    t: string
  }[]
  /** Errors and warnings in the last day, newest last. */
  recent: { t: string; lvl: string; scope: string; msg: string; message?: string }[]
}

export interface DaemonFacts {
  log: string
  running: boolean
  pid?: number
  build?: string
  errors: { t: string; msg: string }[]
}

export interface SettingsFacts {
  files: { path: string; error?: string }[]
  modules: { path: string; exists: boolean }[]
}

/** The package an entry is, when it is one of ours. */
export function bayOf(name: string | undefined): Bay | "bundle" | undefined {
  if (name === BUNDLE) return "bundle"
  const match = /^@opencode-cockpit\/([a-z]+)$/.exec(name ?? "")
  return match && (BAYS as readonly string[]).includes(match[1] as string) ? (match[1] as Bay) : undefined
}

const ours = (facts: Facts) => facts.entries.filter((entry) => bayOf(entry.name))

// ---------------------------------------------------------------------------------------------------

export function checkOpencode(facts: Facts): Check {
  const { version, major } = facts.opencode
  if (!version || major === undefined) {
    return {
      title: "OpenCode",
      state: "fail",
      summary: "`opencode` is not on PATH, or would not say its version",
      fix: ["Install OpenCode: https://opencode.ai"],
    }
  }
  if (major >= 2) return { title: "OpenCode", state: "ok", summary: `${version} (OpenCode 2)` }
  const [minor] = version.split(".").slice(1).map(Number)
  if (major === 1 && (minor ?? 0) >= 18)
    return { title: "OpenCode", state: "ok", summary: `${version} (OpenCode 1)` }
  return {
    title: "OpenCode",
    state: "fail",
    summary: `${version} is older than Cockpit supports`,
    detail: ["Cockpit 0.6 needs OpenCode 1.18 or newer; 0.5.2 was the last for older releases."],
    fix: ["opencode upgrade"],
  }
}

/** The line that pins `name` at `version`, spelled for the OpenCode that is installed. */
function installLine(major: number | undefined, name: string, version: string): string {
  return major !== undefined && major >= 2
    ? `change the entry to "${name}@${version}" in opencode.json, then restart OpenCode`
    : `npx opencode-cockpit@latest update     # or: opencode plugin ${name}@${version} --global --force`
}

export function checkConfig(facts: Facts): Check {
  const major = facts.opencode.major
  const v2 = major !== undefined && major >= 2
  const found = ours(facts)
  const detail: string[] = []
  const fix: string[] = []
  let state = "ok" as State
  const raise = (to: State) => {
    const order: State[] = ["ok", "info", "warn", "fail"]
    if (order.indexOf(to) > order.indexOf(state)) state = to
  }

  for (const error of facts.configErrors) {
    raise("fail")
    detail.push(`${error.path}: ${error.message}`)
  }

  if (found.length === 0) {
    const latest = facts.latest.get(BUNDLE) ?? "<version>"
    return {
      title: "Config",
      state: "fail",
      summary: "Cockpit is not in any OpenCode config",
      detail,
      fix: [
        v2
          ? `opencode plugin add ${BUNDLE}@${latest}`
          : `opencode plugin ${BUNDLE}@${latest} --global --force`,
      ],
    }
  }

  for (const entry of found) detail.push(`${entry.raw}  (${entry.file})`)

  // The same bay twice: the bundle and a standalone package, in the same half.
  for (const half of ["server", "tui"] as const) {
    const here = found.filter((entry) => entry.half === half)
    const bundle = here.some((entry) => bayOf(entry.name) === "bundle")
    for (const entry of here) {
      const bay = bayOf(entry.name)
      if (bundle && bay && bay !== "bundle") {
        raise("warn")
        fix.push(`${entry.raw} is also inside ${BUNDLE}: remove one of them from ${entry.file}`)
      }
    }
  }

  // OpenCode 1 loads each half from its own file; OpenCode 2 loads both from opencode.json.
  if (!v2) {
    const halves = (bay: string) => ({
      server: found.some((entry) => entry.half === "server" && bayOf(entry.name) === bay),
      tui: found.some((entry) => entry.half === "tui" && bayOf(entry.name) === bay),
    })
    for (const bay of ["bundle", ...SERVER_BAYS]) {
      const { server, tui } = halves(bay)
      const name = bay === "bundle" ? BUNDLE : `@opencode-cockpit/${bay}`
      if (server && !tui) {
        raise("warn")
        fix.push(
          `${name} is in opencode.json but not tui.json: its panels will not show — add it to tui.json too`,
        )
      }
      if (tui && !server) {
        raise("warn")
        fix.push(
          `${name} is in tui.json but not opencode.json: the agent has none of its tools — add it to opencode.json too`,
        )
      }
    }
  }

  for (const entry of found) {
    if (entry.spec.kind === "local") {
      if (v2 && facts.checkouts.has(entry.raw)) {
        raise("fail")
        fix.push(
          `${entry.raw} is a git checkout: OpenCode 2 cannot load it beside its own OpenTUI. Point the entry at an install — from the checkout, \`bun run dev:install\` makes one in ~/.cockpit-dev`,
        )
      } else {
        raise("info")
      }
      continue
    }
    const name = entry.spec.name
    const latest = facts.latest.get(name)
    const pin = entry.spec.pin
    if (pin.type !== "exact") {
      raise("warn")
      fix.push(
        `${entry.raw} is not pinned: OpenCode keeps whatever it installed first. ${installLine(major, name, latest ?? "<version>")}`,
      )
      continue
    }
    if (v2 && isNewer("0.6.0", pin.version)) {
      raise("fail")
      fix.push(
        `${entry.raw} is OpenCode 1 only (0.6 is the first for both). ${installLine(major, name, latest ?? "0.6.0")}`,
      )
    } else if (latest && isNewer(latest, pin.version)) {
      raise("warn")
      fix.push(`${entry.raw}: ${latest} is out. ${installLine(major, name, latest)}`)
    }
  }

  const summary =
    state === "fail"
      ? "Cockpit is configured, but will not load as written"
      : state === "warn"
        ? "Cockpit is configured, with something to change"
        : `${found.length} Cockpit entr${found.length === 1 ? "y" : "ies"}`
  return { title: "Config", state, summary, detail, ...(fix.length ? { fix } : {}) }
}

/** What the log says actually ran — the one answer to "config says one thing, OpenCode runs another". */
export function checkRunning(facts: Facts): Check {
  const { log } = facts
  if (!log.exists || log.starts.length === 0) {
    return {
      title: "Last run",
      state: "info",
      summary: "nothing logged yet — start OpenCode once, then run doctor again",
      detail: [`Cockpit logs to ${log.file} from 0.6 on.`],
    }
  }
  const newest = log.starts.reduce((a, b) => (a.t > b.t ? a : b))
  const detail = log.starts
    .slice()
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.entry.localeCompare(b.entry))
    .map(
      (start) =>
        `${start.scope.padEnd(7)} ${start.entry}  ${start.cockpit ?? "?"}  on OpenCode ${start.opencodeVersion ?? start.opencode ?? "?"}  (${start.t})`,
    )
  const versions = new Set(log.starts.map((start) => start.cockpit).filter(Boolean))
  const mixed = versions.size > 1
  return {
    title: "Last run",
    state: mixed ? "warn" : "ok",
    summary: mixed
      ? `different Cockpit versions loaded: ${[...versions].join(", ")}`
      : `Cockpit ${newest.cockpit ?? "?"} on OpenCode ${newest.opencodeVersion ?? newest.opencode ?? "?"}, ${newest.t}`,
    detail,
    ...(mixed ? { fix: ["pin every Cockpit entry at the same version, then restart OpenCode"] } : {}),
  }
}

export function checkErrors(facts: Facts): Check {
  const errors = facts.log.recent.filter((line) => line.lvl === "error")
  const warnings = facts.log.recent.filter((line) => line.lvl === "warn")
  const daemon = facts.daemon.errors
  const total = errors.length + daemon.length
  const detail = [
    ...[...errors, ...warnings]
      .sort((a, b) => a.t.localeCompare(b.t))
      .slice(-5)
      .map(
        (line) =>
          `${line.t}  ${line.lvl.padEnd(5)} ${line.scope}  ${line.msg}${line.message ? `: ${line.message}` : ""}`,
      ),
    ...daemon.slice(-3).map((line) => `${line.t}  error cockpitd  ${line.msg}`),
  ]
  if (total === 0 && warnings.length === 0) {
    return { title: "Errors", state: "ok", summary: "none in the last day" }
  }
  return {
    title: "Errors",
    state: total > 0 ? "warn" : "info",
    summary: `${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}${daemon.length ? `, ${daemon.length} from the daemon` : ""} in the last day`,
    detail,
    fix: [`the full lines, with stacks: tail -100 ${facts.log.file}`],
  }
}

export function checkDaemon(facts: Facts): Check {
  const { daemon } = facts
  if (!daemon.running) {
    return {
      title: "Daemon",
      state: "info",
      summary: "not running — it starts with the first shell, and stops when idle",
      ...(daemon.build ? { detail: [`last build: ${daemon.build}`] } : {}),
    }
  }
  return {
    title: "Daemon",
    state: "ok",
    summary: `running (pid ${daemon.pid})${daemon.build ? `, build ${daemon.build}` : ""}`,
  }
}

export function checkEnvironment(facts: Facts): Check {
  const { env } = facts
  const fix: string[] = []
  if (!env.git) fix.push("git is not on PATH: Review reads the branch through it")
  if (!env.ps) fix.push("ps is not on PATH: the daemon needs it to stop a shell's processes")
  if (!env.homeWritable) fix.push(`${env.home} is not writable: nothing can log, and the daemon cannot start`)
  return {
    title: "Environment",
    state: fix.length ? "fail" : "ok",
    summary: fix.length ? "missing what Cockpit needs" : "git, ps, and a writable Cockpit home",
    ...(fix.length ? { fix } : {}),
  }
}

export function checkSettings(facts: Facts): Check {
  const { settings } = facts
  const fix: string[] = []
  for (const file of settings.files)
    if (file.error) fix.push(`${file.path}: ${file.error} — the whole file is ignored`)
  for (const module of settings.modules) {
    if (!module.exists) fix.push(`statusline module ${module.path} does not exist`)
  }
  const read = settings.files.filter((file) => !file.error).length
  return {
    title: "Settings",
    state: fix.length ? "warn" : "ok",
    summary: fix.length
      ? "a settings file Cockpit cannot use"
      : read === 0
        ? "defaults (no settings file)"
        : `${read} file${read === 1 ? "" : "s"}${settings.modules.length ? `, ${settings.modules.length} statusline module${settings.modules.length === 1 ? "" : "s"}` : ""}`,
    detail: settings.files.map((file) => file.path),
    ...(fix.length ? { fix } : {}),
  }
}

export function allChecks(facts: Facts): Check[] {
  return [
    checkOpencode(facts),
    checkConfig(facts),
    checkRunning(facts),
    checkErrors(facts),
    checkDaemon(facts),
    checkEnvironment(facts),
    checkSettings(facts),
  ]
}
