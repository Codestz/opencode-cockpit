/**
 * Everything doctor looks at, read from the machine through `DoctorIo` — the config files of both
 * OpenCodes, the logs Cockpit writes, the daemon, the tools on PATH — into `Facts` for `checks.ts`.
 *
 * Node APIs only, like the updater it ships with: doctor runs under `npx` because the most useful
 * time to run it is when Cockpit will not load inside OpenCode at all.
 */

import { join, resolve } from "node:path"
import { globalConfigDir } from "../core/configs.ts"
import type { Disk } from "../core/disk.ts"
import { parseJsonc } from "../core/jsonc.ts"
import { parseSpec } from "../core/spec.ts"
import {
  BUNDLE,
  bayOf,
  type DaemonFacts,
  type Entry,
  type Facts,
  type Half,
  type LogFacts,
} from "./checks.ts"

export interface DoctorIo {
  env: Readonly<Record<string, string | undefined>>
  home: string
  cwd: string
  /** The project's worktree root, when `cwd` is in one. */
  worktree?: string
  disk: Disk
  exists(path: string): boolean
  /** Runs a program; undefined when it could not start. */
  run(command: string, args: readonly string[]): { status: number; stdout: string } | undefined
  alive(pid: number): boolean
  writable(dir: string): boolean
  fetchLatest(names: readonly string[]): Promise<Map<string, string | undefined>>
  now: number
}

/** The files each OpenCode reads plugins from, and which half each one loads. */
const CONFIG_FILES: { name: string; half: Half }[] = [
  { name: "opencode.json", half: "server" },
  { name: "opencode.jsonc", half: "server" },
  { name: "tui.json", half: "tui" },
  { name: "tui.jsonc", half: "tui" },
  { name: "cli.json", half: "tui" },
  { name: "cli.jsonc", half: "tui" },
]

/** `COCKPIT_HOME`, else the cache directory — as `@opencode-cockpit/protocol`'s `resolvePaths`. */
export function cockpitHome(io: Pick<DoctorIo, "env" | "home">): string {
  return io.env.COCKPIT_HOME ?? join(io.env.XDG_CACHE_HOME ?? join(io.home, ".cache"), "opencode-cockpit")
}

/**
 * A plugin entry in either OpenCode's spelling: v1's `"spec"` and `["spec", options]` under
 * `plugin`, v2's `"spec"` and `{ package, options }` under `plugins`.
 */
function specsIn(value: unknown): string[] {
  const out: string[] = []
  const config = (value ?? {}) as { plugin?: unknown; plugins?: unknown }
  for (const list of [config.plugin, config.plugins]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item === "string") out.push(item)
      else if (Array.isArray(item) && typeof item[0] === "string") out.push(item[0])
      else if (
        item &&
        typeof item === "object" &&
        typeof (item as { package?: unknown }).package === "string"
      ) {
        out.push((item as { package: string }).package)
      }
    }
  }
  return out
}

/** A local entry is named by its own package.json — that is what OpenCode loads. */
function localPath(raw: string, io: Pick<DoctorIo, "home">, base: string): string {
  const path = raw.replace(/^file:\/\//, "").replace(/^file:/, "")
  if (path.startsWith("~/")) return join(io.home, path.slice(2))
  return resolve(base, path)
}

function readEntries(io: DoctorIo): {
  entries: Entry[]
  errors: Facts["configErrors"]
  checkouts: Set<string>
} {
  const entries: Entry[] = []
  const errors: Facts["configErrors"] = []
  const checkouts = new Set<string>()
  const dirs = [globalConfigDir(io)]
  if (io.worktree) dirs.push(join(io.worktree, ".opencode"), io.worktree)

  for (const dir of dirs) {
    for (const { name, half } of CONFIG_FILES) {
      const file = join(dir, name)
      const text = io.disk.read(file)
      if (text === undefined) continue
      const parsed = parseJsonc(text)
      if (!parsed.ok) {
        errors.push({ path: file, message: parsed.message })
        continue
      }
      for (const raw of specsIn(parsed.value)) {
        const spec = parseSpec(raw)
        let pkgName: string | undefined
        if (spec.kind === "npm") pkgName = spec.name
        else {
          const path = localPath(spec.raw, io, dir)
          const manifest = io.disk.read(join(path, "package.json"))
          try {
            pkgName = manifest ? (JSON.parse(manifest) as { name?: string }).name : undefined
          } catch {
            pkgName = undefined
          }
          /**
           * A checkout has the repository's own OpenTUI beside it, which OpenCode 2 refuses to load
           * next to its own. An install never does: those are dev dependencies.
           */
          if (bayOf(pkgName) && !path.includes("/node_modules/")) {
            for (const up of [path, join(path, ".."), join(path, "..", "..")]) {
              if (io.exists(join(up, "node_modules", "@opentui", "core"))) checkouts.add(raw)
            }
          }
        }
        entries.push({ file, half, raw, spec, name: pkgName })
      }
    }
  }
  return { entries, errors, checkouts }
}

function parseLines(text: string | undefined): Record<string, unknown>[] {
  if (!text) return []
  // The end of the file is what matters; a large log is not parsed whole.
  return text
    .slice(-2_000_000)
    .split("\n")
    .flatMap((line) => {
      if (!line.startsWith("{")) return []
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
}

const DAY = 24 * 60 * 60 * 1000

function readLog(io: DoctorIo, home: string): LogFacts {
  const file = io.env.COCKPIT_LOG_FILE ?? join(home, "cockpit.log")
  const text = io.disk.read(file)
  const lines = parseLines(text)
  const starts = new Map<string, LogFacts["starts"][number]>()
  const recent: LogFacts["recent"] = []
  for (const line of lines) {
    const t = String(line.t ?? "")
    const scope = String(line.scope ?? "")
    if (line.msg === "start" && typeof line.entry === "string") {
      starts.set(`${scope} ${line.entry}`, {
        scope,
        entry: line.entry,
        t,
        ...(typeof line.opencode === "number" ? { opencode: line.opencode } : {}),
        ...(typeof line.opencodeVersion === "string" ? { opencodeVersion: line.opencodeVersion } : {}),
        ...(typeof line.cockpit === "string" ? { cockpit: line.cockpit } : {}),
      })
    }
    if ((line.lvl === "error" || line.lvl === "warn") && io.now - Date.parse(t) < DAY) {
      const error = line.error as { message?: unknown } | undefined
      const message =
        typeof error?.message === "string"
          ? error.message
          : typeof line.message === "string"
            ? line.message
            : undefined
      recent.push({
        t,
        lvl: String(line.lvl),
        scope,
        msg: String(line.msg ?? ""),
        ...(message ? { message } : {}),
      })
    }
  }
  return { file, exists: text !== undefined, starts: [...starts.values()], recent }
}

function readDaemon(io: DoctorIo, home: string): DaemonFacts {
  const log = join(home, "cockpitd.log")
  const lines = parseLines(io.disk.read(log))
  const started = lines.filter((line) => line.msg === "daemon started").at(-1)
  const errors = lines
    .filter((line) => line.lvl === "error" && io.now - Date.parse(String(line.t)) < DAY)
    .map((line) => ({ t: String(line.t), msg: String(line.msg) }))
  const pid = Number.parseInt(io.disk.read(join(home, "cockpitd.pid"))?.trim() ?? "", 10)
  const running = Number.isFinite(pid) && io.alive(pid)
  return {
    log,
    running,
    ...(running ? { pid } : {}),
    ...(typeof started?.build === "string" ? { build: started.build } : {}),
    errors,
  }
}

function readSettings(io: DoctorIo): Facts["settings"] {
  const configDir = join(io.env.XDG_CONFIG_HOME ?? join(io.home, ".config"), "opencode-cockpit")
  const project = io.worktree ?? io.cwd
  const files: Facts["settings"]["files"] = []
  const modules: Facts["settings"]["modules"] = []
  for (const path of [join(configDir, "config.json"), join(project, ".cockpit.json")]) {
    const text = io.disk.read(path)
    if (text === undefined) continue
    const parsed = parseJsonc(text)
    if (!parsed.ok) {
      files.push({ path, error: parsed.message })
      continue
    }
    files.push({ path })
    const config = parsed.value as { statusline?: { modules?: unknown }; modules?: unknown } | null
    const list = config?.statusline?.modules ?? config?.modules
    if (!Array.isArray(list)) continue
    for (const module of list) {
      if (typeof module !== "string") continue
      // As Status resolves them: `~/` is home, absolute is itself, anything else is the project's.
      const full = module.startsWith("~/") ? join(io.home, module.slice(2)) : resolve(project, module)
      modules.push({ path: module, exists: io.exists(full) })
    }
  }
  return { files, modules }
}

export async function gatherFacts(io: DoctorIo): Promise<Facts> {
  const home = cockpitHome(io)
  const versionOut = io.run("opencode", ["--version"])
  const version = versionOut?.status === 0 ? /(\d+\.\d+\.\d+)/.exec(versionOut.stdout)?.[1] : undefined
  const { entries, errors, checkouts } = readEntries(io)
  const names = [
    ...new Set([
      BUNDLE,
      ...entries.flatMap((entry) =>
        entry.spec.kind === "npm" && bayOf(entry.name) ? [entry.spec.name] : [],
      ),
    ]),
  ]
  const latest = await io.fetchLatest(names).catch(() => new Map<string, string | undefined>())
  return {
    opencode: { version, major: version ? Number(version.split(".")[0]) : undefined },
    entries,
    configErrors: errors,
    latest,
    checkouts,
    log: readLog(io, home),
    daemon: readDaemon(io, home),
    env: {
      git: io.run("git", ["--version"])?.status === 0,
      ps: io.run("ps", ["-o", "pid="])?.status === 0,
      homeWritable: io.writable(home),
      home,
    },
    settings: readSettings(io),
  }
}
