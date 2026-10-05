/** What Status's settings are made of: the section's shape, and the kind each key takes. */

/**
 * Where a line is drawn.
 *
 * Two surfaces, deliberately. A third sat inside the prompt box, which is both the narrowest place
 * in the window and the one OpenCode already fills with the agent, the model and the elapsed time:
 * a line there had almost no room and almost nothing left to say.
 */
export type Surface = "bottom" | "sidebar"

/** Where Status draws when nothing says otherwise. The sidebar since 0.9. */
export const DEFAULT_SURFACE: Surface = "sidebar"

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

/**
 * One segment's change, on top of the preset's list (or `segments`): `false` drops it, a name swaps
 * it for that segment in the same place, an object merges into its settings.
 */
export type SegmentChange = false | string | Record<string, unknown>

/**
 * Changes to a line's segments, keyed by segment name: `{ "git": { "against": "branch" } }`. A
 * small change used to mean copying the preset's whole list into `segments`, which then stopped
 * following the preset — and one wrong entry in fourteen was a row gone with no word said.
 */
export type Override = Record<string, SegmentChange>

export interface LineConfig {
  /** A whole line by name; anything written beside it wins. */
  preset?: string
  surface?: Surface
  segments?: (string | SegmentConfig)[]
  /** Changes to the preset's segments, or to `segments`, by segment name. */
  override?: Override
  /** Drawn between segments. Defaults to " · " across, and nothing down. */
  separator?: string
  /** Defaults to vertical in the sidebar, horizontal everywhere else. */
  stack?: Stack
  /** Built-in icons. On by default; switch off for a terminal missing the glyphs. */
  icons?: boolean
  /** Draw a placeholder where a segment said nothing, so a typo and missing data look different. */
  debug?: boolean
  /** Vertical only: rows to draw at most. Lowest priority goes first. The bay's `sidebarRows` by default. */
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

/** The `status` section. */
export interface StatusConfig {
  enabled?: boolean
  /**
   * Draw in the sidebar: the key every bay shares. `false` is read as `surface: "bottom"`, so the
   * one switch works here as it does everywhere; `surface` says the same thing in Status's words.
   */
  sidebar?: boolean
  /**
   * A whole line by name: `minimal`, `default`, `detailed`, `sidebar`. Anything you write
   * alongside it wins, so a preset is a starting point rather than a mode.
   */
  preset?: string
  /** One line, for the common case. Use `lines` for more than one surface. */
  surface?: Surface
  segments?: (string | SegmentConfig)[]
  /**
   * Changes to the preset's segments by name, so changing one row keeps the rest of the preset:
   * `false` drops a segment, a name swaps it, an object merges into its settings. With `segments`
   * written too, the changes apply to those. A line in `lines` may carry its own.
   */
  override?: Override
  separator?: string
  stack?: Stack
  /** Built-in icons. On by default; switch off for a terminal missing the glyphs. */
  icons?: boolean
  /** Draw a placeholder where a segment said nothing, so a typo and missing data look different. */
  debug?: boolean
  /**
   * Rows a column draws at most: the name every bay's sidebar block uses. Inside `lines`, a line's
   * own cap is still `maxRows`.
   */
  sidebarRows?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  lines?: LineConfig[]
  /** Named commands usable as segments: `{"type": "command", "name": "budget"}`. */
  commands?: Record<string, CommandConfig>
  /**
   * Your own segments: paths to modules that export them by name, usable in `segments` exactly
   * like the built-ins. `~` and a path relative to the project both work.
   */
  modules?: string[]
}

/**
 * The kind of value each key takes, as the loader checks it: a value of another kind is dropped
 * with a `!` row naming the key, where it used to reach the renderer and fail there — or nowhere.
 */
export const KINDS = {
  preset: "",
  surface: "",
  segments: [] as unknown[],
  override: {} as Record<string, unknown>,
  separator: "",
  stack: "",
  icons: true,
  debug: false,
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
  lines: [] as unknown[],
  commands: {} as Record<string, unknown>,
  modules: [] as unknown[],
}

export const SURFACES: readonly string[] = ["bottom", "sidebar"]

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
