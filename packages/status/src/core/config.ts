import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Statusline settings, read from the same two files every cockpit bay uses:
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only the `statusline` section is read here. An unreadable or invalid file is ignored rather than
 * fatal — a typo in a config should never cost you the interface.
 */

export const CONFIG_FILE = "config.json"
export const PROJECT_FILE = ".cockpit.json"

/** Where a line is drawn. `bottom` is the full-width line under the prompt. */
export type Surface = "bottom" | "promptRight" | "sidebar"

/**
 * A segment is either a built-in named by string ("cwd"), or that name with settings. `when` and
 * `priority` are what make a line survive a narrow terminal instead of wrapping into noise.
 */
export interface SegmentConfig {
  type: string
  /** Text placed before the value, e.g. "on ". */
  prefix?: string
  suffix?: string
  /** Higher survives when the line has to be shortened. Defaults per built-in. */
  priority?: number
  /** Theme colour name (`success`, `warning`, `textMuted`…) or a literal `#rrggbb`. */
  color?: string
  /** Built-in specific settings, e.g. `{ "style": "bar" }` for context. */
  [key: string]: unknown
}

export interface CommandConfig {
  /** Shell command whose stdout becomes the segment's text. */
  run: string
  /** How often it may run. Defaults to 2000ms; it never runs more than once at a time. */
  intervalMs?: number
  /** Kill and ignore the output after this long. Defaults to 1000ms. */
  timeoutMs?: number
  /**
   * Feed the command Claude Code's statusline JSON on stdin, so an existing statusline script
   * works unchanged. On by default.
   */
  claudeCodeCompat?: boolean
  priority?: number
}

export interface LineConfig {
  surface?: Surface
  segments?: (string | SegmentConfig)[]
  /** Drawn between segments. Defaults to " · ". */
  separator?: string
}

export interface StatusConfig {
  enabled?: boolean
  /** One line, for the common case. Use `lines` for more than one surface. */
  surface?: Surface
  segments?: (string | SegmentConfig)[]
  separator?: string
  lines?: LineConfig[]
  /** Named commands usable as segments: `{"type": "command", "name": "budget"}`. */
  commands?: Record<string, CommandConfig>
}

export interface CockpitStatusConfig {
  statusline?: StatusConfig
}

export function globalConfigPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config")
  return join(base, "opencode-cockpit", CONFIG_FILE)
}

/** Reads and merges every source. `options` is the plugin entry's own options object. */
export function loadStatusConfig(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): StatusConfig {
  return mergeStatus(
    mergeStatus(readStatusFile(globalConfigPath(env)), readStatusFile(join(directory, PROJECT_FILE))),
    asStatusConfig(options),
  )
}

export function readStatusFile(path: string): StatusConfig {
  if (!existsSync(path)) return {}
  try {
    return asStatusConfig(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return {}
  }
}

/**
 * Section-wise merge. `segments` is replaced rather than concatenated: a project that lists its
 * own segments means "this line", not "these as well as the global ones".
 */
export function mergeStatus(base: StatusConfig, over: StatusConfig): StatusConfig {
  const merged: StatusConfig = { ...base, ...over }
  if (base.commands || over.commands) merged.commands = { ...base.commands, ...over.commands }
  return merged
}

/**
 * Accepts either a whole cockpit config (`{ statusline: {...} }`) or the statusline section on its
 * own, because plugin-entry options are written straight onto the `tui.json` entry.
 */
export function asStatusConfig(input: unknown): StatusConfig {
  if (!input || typeof input !== "object") return {}
  const raw = input as Record<string, unknown>
  const section = raw.statusline ?? (raw.status as unknown)
  if (section && typeof section === "object") return section as StatusConfig
  const own: StatusConfig = {}
  for (const key of ["enabled", "surface", "segments", "separator", "lines", "commands"] as const) {
    if (raw[key] !== undefined) Object.assign(own, { [key]: raw[key] })
  }
  return own
}

/** The default line: what someone who writes nothing at all should see. */
export const DEFAULT_SEGMENTS: (string | SegmentConfig)[] = [
  "cwd",
  "git.branch",
  "git.diff",
  "model",
  "context",
  "cost",
  "todo",
  "session.status",
  "diagnostics",
]

export const DEFAULT_SEPARATOR = " · "

/** Normalises whatever the config said into the lines the renderer draws. */
export function resolveLines(
  config: StatusConfig,
): Required<Pick<LineConfig, "surface" | "segments" | "separator">>[] {
  const lines = config.lines?.length
    ? config.lines
    : [{ surface: config.surface, segments: config.segments, separator: config.separator }]
  return lines.map((line) => ({
    surface: line.surface ?? "bottom",
    segments: line.segments ?? config.segments ?? DEFAULT_SEGMENTS,
    separator: line.separator ?? config.separator ?? DEFAULT_SEPARATOR,
  }))
}

/** A segment written as a bare string is that built-in with no settings. */
export function asSegmentConfig(entry: string | SegmentConfig): SegmentConfig {
  return typeof entry === "string" ? { type: entry } : entry
}
