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

/**
 * Where a line is drawn.
 *
 * Two surfaces, deliberately. A third sat inside the prompt box, which is both the narrowest place
 * in the window and the one OpenCode already fills with the agent, the model and the elapsed time:
 * a line there had almost no room and almost nothing left to say.
 */
export type Surface = "bottom" | "sidebar"

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

/**
 * How a line lays its segments out. A wide line under the prompt reads across; a sidebar four
 * columns wide reads down.
 */
export type Stack = "horizontal" | "vertical"

export interface LineConfig {
  surface?: Surface
  segments?: (string | SegmentConfig)[]
  /** Drawn between segments. Defaults to " · " across, and nothing down. */
  separator?: string
  /** Defaults to vertical in the sidebar, horizontal everywhere else. */
  stack?: Stack
  /** Built-in icons. On by default; switch off for a terminal missing the glyphs. */
  icons?: boolean
  /** Vertical only: rows to draw at most. Lowest priority goes first. Defaults to 8. */
  maxRows?: number
  /**
   * Columns of space either side. The defaults line each surface up with OpenCode's own
   * furniture -- its footer indents three, its prompt keeps two clear on the right -- so the line
   * reads as part of the interface rather than as something bolted underneath it.
   */
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
}

export interface StatusConfig {
  enabled?: boolean
  /** One line, for the common case. Use `lines` for more than one surface. */
  surface?: Surface
  segments?: (string | SegmentConfig)[]
  separator?: string
  stack?: Stack
  /** Built-in icons. On by default; switch off for a terminal missing the glyphs. */
  icons?: boolean
  lines?: LineConfig[]
  /** Named commands usable as segments: `{"type": "command", "name": "budget"}`. */
  commands?: Record<string, CommandConfig>
  /**
   * Your own segments: paths to modules that export them by name, usable in `segments` exactly
   * like the built-ins. `~` and a path relative to the project both work.
   */
  modules?: string[]
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
  // Modules add up: a project can bring its own segments without losing the ones you use everywhere.
  if (base.modules || over.modules) merged.modules = [...(base.modules ?? []), ...(over.modules ?? [])]
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
  for (const key of [
    "enabled",
    "surface",
    "segments",
    "separator",
    "stack",
    "icons",
    "lines",
    "commands",
    "modules",
  ] as const) {
    if (raw[key] !== undefined) Object.assign(own, { [key]: raw[key] })
  }
  return own
}

/**
 * The default line: what someone who writes nothing at all should see.
 *
 * It took a long walk to arrive here, and the shape is the point. A capacity bar that means
 * something at a glance, the total beside the three quantities that make it up, what changed, how
 * long it has been. Colour carries which is which; the separators carry the grouping.
 *
 * It does repeat one thing OpenCode already shows -- the token count and the percentage, which its
 * footer carries in a corner. That is deliberate. The rule is not to avoid every fact the host
 * mentions, it is to avoid saying it no better than the host does: a bar you can read without
 * looking, with the breakdown beside it, is a different instrument from "78.5K (39%)" in the
 * corner. What stays out are the facts a second copy adds nothing to -- the path, the branch, the
 * model, the spend.
 */
export const DEFAULT_SEGMENTS: (string | SegmentConfig)[] = [
  { type: "context", style: "bar", width: 14, icon: "" },
  { type: "tokens", format: "tk {total}", icon: "" },
  { type: "tokens", format: "cache {cacheRead}", color: "success", icon: "" },
  { type: "tokens", format: "in {input}", color: "info", icon: "" },
  { type: "tokens", format: "out {output}", color: "accent", icon: "" },
  { type: "session.diff", icon: "" },
  { type: "session.time", icon: "" },
  "todo",
  "session.status",
  "diagnostics",
]

export const DEFAULT_SEPARATOR = " │ "

export interface ResolvedLine {
  surface: Surface
  segments: (string | SegmentConfig)[]
  separator: string
  stack: Stack
  maxRows: number
  icons: boolean
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
}

/** What each surface needs to sit level with the host's own content. */
const PADDING: Record<Surface, { left: number; right: number; top: number; bottom: number }> = {
  // OpenCode's footer indents three columns, and a line hard against the bottom of the window
  // reads as clipped, so this one keeps a row clear underneath it.
  bottom: { left: 3, right: 2, top: 0, bottom: 1 },
  // Flush with the sidebar's own content, which the shell bay draws with no padding at all.
  sidebar: { left: 0, right: 0, top: 0, bottom: 0 },
}

/** Normalises whatever the config said into the lines the renderer draws. */
export function resolveLines(config: StatusConfig): ResolvedLine[] {
  const lines = config.lines?.length
    ? config.lines
    : [
        {
          surface: config.surface,
          segments: config.segments,
          separator: config.separator,
          stack: config.stack,
          icons: config.icons,
        },
      ]
  return lines.map((line) => {
    const surface = line.surface ?? "bottom"
    // The sidebar is a narrow column: across, it would be three truncated words.
    const stack = line.stack ?? config.stack ?? (surface === "sidebar" ? "vertical" : "horizontal")
    return {
      surface,
      segments: line.segments ?? config.segments ?? DEFAULT_SEGMENTS,
      separator: line.separator ?? config.separator ?? (stack === "vertical" ? "" : DEFAULT_SEPARATOR),
      stack,
      maxRows: line.maxRows ?? 8,
      icons: line.icons ?? config.icons ?? true,
      paddingLeft: line.paddingLeft ?? PADDING[surface].left,
      paddingRight: line.paddingRight ?? PADDING[surface].right,
      paddingTop: line.paddingTop ?? PADDING[surface].top,
      paddingBottom: line.paddingBottom ?? PADDING[surface].bottom,
    }
  })
}

/** A segment written as a bare string is that built-in with no settings. */
export function asSegmentConfig(entry: string | SegmentConfig): SegmentConfig {
  return typeof entry === "string" ? { type: entry } : entry
}
