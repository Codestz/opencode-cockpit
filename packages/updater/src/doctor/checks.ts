/**
 * What `opencode-cockpit doctor` concludes, from facts gathered elsewhere (`gather.ts`). Pure: every
 * check takes what was found and says what it means — so each one is tested against a machine made
 * of an object, and a check never touches the disk it is judging.
 *
 * Every problem carries the command that fixes it, for the OpenCode that is actually installed: the
 * point is not a report, it is the next step (docs/roadmap/doctor.md).
 */

import { BUNDLE, bayOf } from "@opencode-cockpit/client/plugin-entries"
import type { Bay } from "@opencode-cockpit/client/settings"
import { RESTART_COMMAND } from "../core/service.ts"
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

/** Bays whose agent half doctor checks is loaded beside the interface's (`doctor.test.ts` checks it). */
export const SERVER_BAYS: readonly Bay[] = ["shell", "status", "review", "subagents", "trail"]

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
  env: {
    git: boolean
    ps: boolean
    homeWritable: boolean
    home: string
    /**
     * Whether OpenCode 1 would offer background subagents, read off the environment doctor runs in —
     * the one OpenCode inherits when started from the same shell. Unset when not gathered.
     */
    backgroundSubagents?: boolean
  }
  settings: SettingsFacts
  /** OpenCode 2's background service; unset on OpenCode 1. */
  service?: ServiceFacts
  /** When doctor ran, so a log line's time reads as `7h ago`. Unset prints the time as logged. */
  now?: number
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

export interface ServiceFacts {
  state: "running" | "stopped" | "unknown"
  url?: string
  /** When it started, ms since the epoch. */
  startedAt?: number
  /** When the newest Cockpit install it loads last changed, and which entry that is. */
  installedAt?: number
  installed?: string
  /**
   * What its agent side said it loaded when it started (`@opencode-cockpit/client/service`), and what
   * is in that place now — undefined when the install is gone. Unset when the agent side wrote nothing
   * (a Cockpit older than 0.9, or no window has opened since it started).
   */
  agent?: { loaded: { version: string; installedAt: number }; now?: { version: string; installedAt: number } }
}

export interface SettingsFacts {
  files: { path: string; error?: string }[]
  modules: { path: string; exists: boolean }[]
  /** What the settings loader would tell a bay: unknown names and sidebar entries, wrong types. */
  notices?: { file: string; text: string }[]
}

const ours = (facts: Facts) => facts.entries.filter((entry) => bayOf(entry.name))

/**
 * Whether the OpenCode installed reads this entry's file. OpenCode 1 reads `opencode.json` and
 * `tui.json`; OpenCode 2 reads `opencode.json` — for both halves — and `cli.json`. A `cli.json` entry
 * does nothing on OpenCode 1, and a `tui.json` one is only copied into `cli.json` once, on OpenCode 2's
 * first start.
 */
export function readBy(entry: Entry, v2: boolean): boolean {
  const name = entry.file.split("/").pop() ?? ""
  if (name.startsWith("opencode.")) return true
  return v2 ? name.startsWith("cli.") : name.startsWith("tui.")
}

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

  for (const entry of found) {
    const ignored = readBy(entry, v2) ? "" : `  — not read by OpenCode ${v2 ? 2 : 1}`
    detail.push(`${entry.raw}  (${entry.file})${ignored}`)
  }
  const read = found.filter((entry) => readBy(entry, v2))

  /**
   * The same bay twice: the bundle and a standalone package. On OpenCode 1 per half, since each half
   * has its own file. On OpenCode 2 across every file it reads: `opencode.json` loads the interface
   * too, so the bundle there and a bay in `cli.json` is the same bay loaded twice.
   */
  const groups = v2 ? [read] : [read.filter((e) => e.half === "server"), read.filter((e) => e.half === "tui")]
  for (const here of groups) {
    const bundle = here.find((entry) => bayOf(entry.name) === "bundle")
    for (const entry of here) {
      const bay = bayOf(entry.name)
      if (bundle && bay && bay !== "bundle") {
        raise("warn")
        fix.push(`${entry.raw} (${entry.file}) is also inside ${BUNDLE} (${bundle.file}): remove one of them`)
      }
    }
  }

  // OpenCode 1 loads each half from its own file; OpenCode 2 loads both from opencode.json.
  if (!v2) {
    const halves = (bay: string) => ({
      server: read.some((entry) => entry.half === "server" && bayOf(entry.name) === bay),
      tui: read.some((entry) => entry.half === "tui" && bayOf(entry.name) === bay),
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

/**
 * A logged time, as how long ago it was. `2026-09-30T03:08:18.610Z` is exact and says nothing at a
 * glance; "was that this morning's OpenCode or last week's" is the question the line is read for.
 */
export function ago(t: string, now: number | undefined): string {
  const at = Date.parse(t)
  if (now === undefined || Number.isNaN(at)) return t
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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
        `${start.scope.padEnd(7)} ${start.entry}  ${start.cockpit ?? "?"}  on OpenCode ${start.opencodeVersion ?? start.opencode ?? "?"}  (${ago(start.t, facts.now)})`,
    )
  const versions = new Set(log.starts.map((start) => start.cockpit).filter(Boolean))
  const mixed = versions.size > 1
  return {
    title: "Last run",
    state: mixed ? "warn" : "ok",
    summary: mixed
      ? `different Cockpit versions loaded: ${[...versions].join(", ")}`
      : `Cockpit ${newest.cockpit ?? "?"} on OpenCode ${newest.opencodeVersion ?? newest.opencode ?? "?"}, ${ago(newest.t, facts.now)}`,
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
          `${ago(line.t, facts.now).padEnd(8)}  ${line.lvl.padEnd(5)} ${line.scope}  ${line.msg}${line.message ? `: ${line.message}` : ""}`,
      ),
    ...daemon.slice(-3).map((line) => `${ago(line.t, facts.now).padEnd(8)}  error cockpitd  ${line.msg}`),
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
  const broken = fix.length > 0
  for (const notice of settings.notices ?? []) fix.push(`${notice.file}: ${notice.text}`)
  const noted = fix.length > 0
  for (const module of settings.modules) {
    if (!module.exists) fix.push(`statusline module ${module.path} does not exist`)
  }
  const read = settings.files.filter((file) => !file.error).length
  return {
    title: "Settings",
    state: fix.length ? "warn" : "ok",
    summary: broken
      ? "a settings file Cockpit cannot use"
      : noted
        ? "settings that are not read as written"
        : fix.length
          ? "a statusline module is missing"
          : read === 0
            ? "defaults (no settings file)"
            : `${read} file${read === 1 ? "" : "s"}${settings.modules.length ? `, ${settings.modules.length} statusline module${settings.modules.length === 1 ? "" : "s"}` : ""}`,
    detail: settings.files.map((file) => file.path),
    ...(fix.length ? { fix } : {}),
  }
}

/**
 * Background subagents, where Subagents is installed. OpenCode 2 has them built in; OpenCode 1 only
 * when started with its experimental flag, which no plugin can set. Without it the main agent waits on
 * every subagent it launches — and, in the 0.8 load test, concluded background was broken.
 */
export function checkSubagents(facts: Facts): Check | undefined {
  const installed = ours(facts).some((entry) => {
    const bay = bayOf(entry.name)
    return entry.half === "server" && (bay === "subagents" || bay === "bundle")
  })
  const { major } = facts.opencode
  if (!installed || major === undefined || facts.env.backgroundSubagents === undefined) return undefined
  if (major >= 2) return { title: "Subagents", state: "ok", summary: "background subagents built in" }
  if (facts.env.backgroundSubagents)
    return { title: "Subagents", state: "ok", summary: "background subagents on (OpenCode 1's flag is set)" }
  return {
    title: "Subagents",
    state: "warn",
    summary: "OpenCode 1 runs every subagent in the foreground: its background flag is not set",
    detail: [
      "The main agent waits for each subagent it launches. Cockpit tells it so, and to launch independent ones in one message so they run side by side.",
      "Read off the environment doctor runs in; OpenCode started elsewhere (an editor, a launcher) may differ.",
    ],
    fix: [
      "export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true   # in ~/.zshrc or your shell's profile, then restart OpenCode",
    ],
  }
}

/**
 * OpenCode 2's background service loads plugins once, when it starts. Started before Cockpit was last
 * installed, it still runs the old agent side — the windows draw the new interface, the agent has the
 * old tools and skills — until it restarts.
 */
export function checkService(facts: Facts): Check | undefined {
  const { service } = facts
  if (!service) return undefined
  const title = "Service"
  if (service.state === "stopped")
    return {
      title,
      state: "ok",
      summary: "OpenCode 2's background service is not running; a window starts it",
    }
  if (service.state === "unknown")
    return {
      title,
      state: "info",
      summary: "could not ask OpenCode 2 about its background service",
      detail: ["After updating Cockpit, restart it so it loads the new agent side."],
      fix: [RESTART_COMMAND],
    }
  const when = (at: number) => ago(new Date(at).toISOString(), facts.now)
  /** What the agent side said it loaded, against what is installed there now: no clocks to compare. */
  if (service.agent) {
    const { loaded, now } = service.agent
    const same = now && now.version === loaded.version && now.installedAt === loaded.installedAt
    if (same)
      return {
        title,
        state: "ok",
        summary: `OpenCode 2's background service runs the installed Cockpit (${loaded.version})`,
      }
    return {
      title,
      state: "warn",
      summary: "OpenCode 2's background service has the old Cockpit: it was installed again since it started",
      detail: [
        now
          ? `It loaded ${loaded.version}, installed ${when(loaded.installedAt)}; ${now.version} was installed ${when(now.installedAt)}.`
          : `It loaded ${loaded.version}, from an install that is no longer there.`,
        "It loads plugins once, when it starts: the agent keeps the old tools and skills until it restarts.",
      ],
      fix: [RESTART_COMMAND],
    }
  }
  const { startedAt, installedAt } = service
  if (startedAt === undefined || installedAt === undefined)
    return {
      title,
      state: "info",
      summary: `OpenCode 2's background service is running${service.url ? ` (${service.url})` : ""}`,
      detail: [
        startedAt === undefined ? "Could not tell when it started." : `Started ${when(startedAt)}.`,
        "It loads plugins when it starts: after updating Cockpit, restart it.",
      ],
      fix: [RESTART_COMMAND],
    }
  // A second of slack: an install and a start in the same moment are the same moment.
  if (startedAt + 1000 < installedAt)
    return {
      title,
      state: "warn",
      summary: "OpenCode 2's background service has the old Cockpit: it started before the install",
      detail: [
        `Started ${when(startedAt)}; ${service.installed ?? "Cockpit"} was installed ${when(installedAt)}.`,
        "It loads plugins once, when it starts: the agent keeps the old tools and skills until it restarts.",
      ],
      fix: [RESTART_COMMAND],
    }
  return {
    title,
    state: "ok",
    summary: `OpenCode 2's background service started ${when(startedAt)}, after the install`,
  }
}

export function allChecks(facts: Facts): Check[] {
  const subagents = checkSubagents(facts)
  const service = checkService(facts)
  return [
    checkOpencode(facts),
    checkConfig(facts),
    checkRunning(facts),
    checkErrors(facts),
    checkDaemon(facts),
    ...(service ? [service] : []),
    checkEnvironment(facts),
    ...(subagents ? [subagents] : []),
    checkSettings(facts),
  ]
}
