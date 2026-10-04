import {
  baySettings,
  closestName,
  noticeText,
  OPTIONS_SOURCE,
  type Settings,
  type SettingsNotice,
  type SettingsWhere,
} from "@opencode-cockpit/client/settings"

/**
 * Status's settings: the `status` section of the files every cockpit bay reads, through the one
 * loader in `@opencode-cockpit/client/settings`:
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only `status` is read. `statusline` (the section's name until 0.9) and keys at the file's root are
 * old names: the loader recognises them and the bay draws a `!` row for each, but their values are
 * not read. A file that cannot be parsed is a notice too, never the end of the interface.
 */

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

const SURFACES: readonly string[] = ["bottom", "sidebar"]

export interface LoadedStatus {
  /** Every source merged, as written: the gaps are `resolveLines`'s to fill. */
  config: StatusConfig
  /** The block's place in the sidebar, from the top-level `sidebar` list. */
  order: number
  /**
   * What to fix, one `!` row each: Status's own settings, and — because Status is the one bay every
   * install draws — the notices that belong to no bay (a file that would not parse, a top-level
   * name nothing reads, an entry in the `sidebar` list that is not a bay).
   */
  notices: string[]
  settings: Settings
}

export interface StatusInput {
  /** The plugin entry's options: the section's own keys, or a whole config with a `status` section. */
  options?: unknown
  where?: SettingsWhere
  /** Already loaded, as `cockpit_settings` and doctor have them. */
  settings?: Settings
}

/** Reads and merges every source. Never throws. */
export function loadStatus(input: StatusInput = {}): LoadedStatus {
  const loaded = baySettings("status", KINDS, {
    options: input.options,
    ...(input.settings ? { settings: input.settings } : { where: input.where }),
  })
  const written = loaded.written as StatusConfig
  const config: StatusConfig = { ...written }
  /** `features.status: false` turns the bay off as `enabled: false` does. */
  if (!loaded.config.enabled) config.enabled = false
  /** The shared switch, in Status's words: off the sidebar means at the bottom. */
  if (written.sidebar === false && written.surface === undefined) config.surface = "bottom"
  if (typeof written.sidebarRows === "number") config.sidebarRows = loaded.config.sidebarRows
  /**
   * Modules add up rather than replace: a project can bring its own segments without losing the ones
   * you use everywhere. Every other list replaces the one before it, as in every bay.
   */
  const modules = [
    ...loaded.settings.layers.flatMap((layer) => strings(layer.sections.status?.modules)),
    ...strings(optionsSection(input.options)?.modules),
  ]
  if (modules.length > 0) config.modules = [...new Set(modules)]
  else delete config.modules

  const own = [...cockpitNoticesOf(loaded.settings), ...loaded.notices].map(noticeText)
  return {
    config,
    order: loaded.order,
    notices: [...own, ...configNotices(config)],
    settings: loaded.settings,
  }
}

/** Every source merged, as written. */
export function loadStatusConfig(directory: string, options?: unknown, env = process.env): StatusConfig {
  return loadStatus({ options, where: { directory, env } }).config
}

const cockpitNoticesOf = (settings: Settings): SettingsNotice[] =>
  settings.notices.filter((notice) => notice.bay === "cockpit")

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : []

/** Plugin options as the section: a whole config's `status`, else the options themselves. */
function optionsSection(options: unknown): Record<string, unknown> | undefined {
  if (!isObject(options)) return undefined
  return isObject(options.status) ? options.status : options
}

/** One thing wrong in Status's settings that only Status can tell, and the key it is about. */
export interface StatusProblem {
  /** The section key it is about: `preset`, `surface`, `override`, or `lines` for one of the lines'. */
  key: "preset" | "surface" | "override" | "lines"
  /** Without the `settings: ` the row adds. */
  text: string
}

/**
 * What the loader cannot know is wrong, because only Status knows its vocabulary: a preset nothing
 * answers to, a surface that does not exist. Each used to fall back in silence — an unknown preset
 * was quietly the default line, which looks like a preset that does nothing.
 */
export function configNotices(config: StatusConfig): string[] {
  return configProblems(config).map((problem) => `settings: ${problem.text}`)
}

/** The same, with the key each one is about: for a notice that names its file (`statusNotices`). */
export function configProblems(config: StatusConfig): StatusProblem[] {
  const out: StatusProblem[] = []
  const names = Object.keys(PRESETS).join(", ")
  const lines: LineConfig[] = [config, ...(Array.isArray(config.lines) ? config.lines : [])]
  for (const [index, line] of lines.entries()) {
    const where = index === 0 ? "status" : `status.lines[${index - 1}]`
    const key = index === 0 ? undefined : "lines"
    /** The name first: in a 24-column sidebar it is what survives the wrap. */
    if (typeof line.preset === "string" && !PRESETS[line.preset]) {
      out.push({ key: key ?? "preset", text: `no preset "${line.preset}" (${names})` })
    }
    if (line.surface !== undefined && !SURFACES.includes(line.surface)) {
      out.push({ key: key ?? "surface", text: `"${where}.surface" is "sidebar" or "bottom"` })
    }
  }
  return [...out, ...overrideProblems(config)]
}

/**
 * An override that changes nothing is said out loud: `"gti"` matching no segment would otherwise
 * be a row that kept its old look with no word as to why. A section-wide override is checked against
 * every line that uses it, and is only wrong when it matches none of them.
 */
function overrideProblems(config: StatusConfig): StatusProblem[] {
  const out: StatusProblem[] = []
  const checked = new Map<Override, { where: string; from: string; types: Set<string> }>()
  for (const [index, source] of lineSources(config).entries()) {
    const raw = source.line.override ?? config.override
    const where = source.line.override !== undefined && config.lines?.length ? `status.lines[${index}].` : ""
    if (raw === undefined) continue
    if (!isObject(raw)) {
      out.push({
        key: where ? "lines" : "override",
        text: `"${where || "status."}override" should be an object of segment names`,
      })
      continue
    }
    const base = baseSegments(source.line, config)
    const seen = checked.get(raw) ?? { where, from: base.from, types: new Set<string>() }
    for (const entry of base.segments) seen.types.add(segmentType(entry))
    checked.set(raw, seen)
  }
  for (const [override, { where, from, types }] of checked) {
    const key = where ? "lines" : "override"
    for (const [name, change] of Object.entries(override)) {
      if (!isChange(change)) {
        out.push({
          key,
          text: `${where}override "${name}" is false, a segment name, or an object of its settings`,
        })
      } else if (!types.has(name)) {
        const meant = closestSegment(name, [...types])
        out.push({
          key,
          text: `${where}override "${name}" matches no segment in ${from}${meant ? ` — did you mean "${meant}"?` : ""}`,
        })
      }
    }
  }
  return out
}

/**
 * Every notice Status draws for these settings, as notices — the loader's, its own keys' kinds, and
 * its vocabulary's — each naming the file its key was written in. Offered to `cockpit_settings` and
 * doctor (`offerSettingsCheck`), so "Notices: none" there means no `!` row here.
 */
export function statusNotices(input: { settings: Settings; options?: unknown }): SettingsNotice[] {
  const loaded = loadStatus({ options: input.options, settings: input.settings })
  const options = optionsSection(input.options)
  /** The last source that wrote the key: plugin options win, then the project file, then the global. */
  const fileOf = (key: StatusProblem["key"]) =>
    options && key in options
      ? OPTIONS_SOURCE
      : ([...input.settings.layers]
          .reverse()
          .find((layer) => layer.sections.status && key in layer.sections.status)?.path ?? "status")
  const own = baySettings("status", KINDS, { options: input.options, settings: input.settings }).notices
  return [
    ...own,
    ...configProblems(loaded.config).map(
      (problem): SettingsNotice => ({
        bay: "status",
        file: fileOf(problem.key),
        kind: "invalid",
        text: problem.text,
      }),
    ),
  ]
}

/** The name a typo most likely meant: the same letters in another order first (`gti` → `git`). */
function closestSegment(name: string, valid: string[]): string | undefined {
  const letters = (text: string) => [...text].sort().join("")
  return valid.find((each) => letters(each) === letters(name)) ?? closestName(name, valid)
}

const isChange = (change: unknown): change is SegmentChange =>
  change === false || (typeof change === "string" && change.length > 0) || isObject(change)

const segmentType = (entry: string | SegmentConfig) => (typeof entry === "string" ? entry : entry.type)

/**
 * A line's segments with an override applied, each change in the place of the segment it names —
 * every segment of that name, so `{ "sep": false }` takes out every hairline. A change that is not
 * one (`true`, a number) leaves the segment as it was; `configNotices` says so.
 */
export function applyOverride(
  segments: readonly (string | SegmentConfig)[],
  override: unknown,
): (string | SegmentConfig)[] {
  if (!isObject(override)) return [...segments]
  const out: (string | SegmentConfig)[] = []
  for (const entry of segments) {
    const type = segmentType(entry)
    const change = Object.hasOwn(override, type) ? override[type] : undefined
    if (!isChange(change)) out.push(entry)
    else if (change === false) continue
    else if (typeof change === "string") out.push(change)
    else out.push({ ...asSegmentConfig(entry), ...change } as SegmentConfig)
  }
  return out
}

/**
 * The default line: what someone who writes nothing at all should see.
 *
 * It took a long walk to arrive here, and the shape is the point. A capacity bar that means
 * something at a glance, the total beside the three quantities that make it up, what changed, how
 * long the last answer took. Words say which is which, muted, with the figures beside them in the text colour;
 * colour is left for what it signals — the bar's level, what was added and removed, a retry. It used
 * to carry the labels too, and three greens on one line meant three different things.
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
  { type: "tokens", format: "cache {cacheRead}", icon: "" },
  { type: "tokens", format: "in {input}", icon: "" },
  { type: "tokens", format: "out {output}", icon: "" },
  { type: "git.diff", icon: "" },
  { type: "session.time", of: "turn", icon: "" },
  "todo",
  "session.status",
  "diagnostics",
]

export const DEFAULT_SEPARATOR = " │ "

/**
 * The sidebar's column: a table. A heading, the window as one solid bar, the tokens broken into named
 * rows, a proxy's budget, and the branch's whole diff.
 *
 * It is the layout a user arrived at after five rejected iterations, and the reasons are worth more
 * than the rows: every number gets a word, the labels are a fixed column so the values line up, the
 * bar is solid rather than dashed, and the groups are separated by hairlines rather than headings — a
 * heading cannot know whether the rows under it will draw. A row whose figure is zero is not drawn,
 * the budget rows say nothing without a proxy, and a hairline with nothing on one side of it goes too.
 *
 * It sits beside OpenCode's own Context block and says it better; turn that one off with
 * `{ "plugin_enabled": { "internal:sidebar-context": false } }` in `tui.json` (OpenCode 1) or
 * `"-opencode.sidebar.context"` in `cli.json`'s `plugins` (OpenCode 2).
 */
export const SIDEBAR_SEGMENTS: (string | SegmentConfig)[] = [
  "title",
  { type: "context", style: "solid", width: 16, icon: "" },
  /**
   * Why it stalled — `retry 2 in 5s` — which OpenCode shows as a spinner and nothing more. It is the
   * reason this bay exists, so it outranks everything but the bar when rows run out; under the bar
   * rather than above it, so a row that comes and goes does not move the bar about.
   */
  { type: "session.status", priority: 95, icon: "", working: false },
  /**
   * A broken MCP or language server — `! github, linear +2` in red — and nothing while every one is
   * healthy. The table is the default now, so it is where most people would ever learn one failed.
   */
  "diagnostics",
  { type: "tokens", style: "row", icon: "" },
  "in",
  "out",
  "cache",
  "write",
  "sep",
  "spend",
  "avail",
  "sep",
  "git",
]

/**
 * Whole lines, by the name of what you want.
 *
 * Composing a good statusline from fourteen segments is a design exercise, and most people want a
 * good line rather than the exercise. Every preset is built-ins only — none needs a module, a
 * command, or anything installed beside it.
 */
export const PRESETS: Record<
  string,
  { about: string; surface: Surface; segments: (string | SegmentConfig)[]; maxRows?: number }
> = {
  minimal: {
    about: "how full the context is, and what changed",
    surface: "bottom",
    segments: [
      { type: "context", style: "bar", width: 12, icon: "" },
      { type: "git.diff", icon: "" },
      "session.status",
      "diagnostics",
    ],
  },
  default: {
    about: "the capacity bar, where the tokens went, what changed, how long",
    surface: "bottom",
    segments: DEFAULT_SEGMENTS,
  },
  detailed: {
    about: "everything the built-ins know, for a wide window",
    surface: "bottom",
    segments: [
      { type: "context", style: "split", width: 14, icon: "" },
      { type: "tokens", style: "parts", icon: "" },
      { type: "model", icon: "" },
      "cost",
      { type: "git.diff", icon: "" },
      "todo",
      { type: "session.time", of: "turn", icon: "" },
      "session.status",
      "diagnostics",
    ],
  },
  sidebar: {
    about: "a table: the window, where the tokens went, a proxy's budget, the branch's diff",
    surface: "sidebar",
    segments: SIDEBAR_SEGMENTS,
    /** Every row it has, on a busy session with a budget: the table is the point of it. */
    maxRows: 14,
  },
}

/** What a line draws when it names no preset and lists no segments: the surface's own. */
const PRESET_FOR: Record<Surface, string> = { sidebar: "sidebar", bottom: "default" }

export interface ResolvedLine {
  surface: Surface
  segments: (string | SegmentConfig)[]
  separator: string
  stack: Stack
  maxRows: number
  icons: boolean
  debug: boolean
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

/** Rows a column draws when neither the line, the bay nor the preset says. */
const MAX_ROWS = 8

/** The lines as written: `lines`, or the section itself as the one line. */
function lineSources(config: StatusConfig): { line: LineConfig }[] {
  if (config.lines?.length) return config.lines.map((line) => ({ line }))
  return [
    {
      line: {
        preset: config.preset,
        surface: config.surface,
        segments: config.segments,
        override: config.override,
        separator: config.separator,
        stack: config.stack,
        icons: config.icons,
        debug: config.debug,
      },
    },
  ]
}

/**
 * Where a line draws and the segments it starts from, before its override — and what to call that
 * list in a notice: `the sidebar preset`, or the `segments` that were written.
 */
function baseSegments(
  line: LineConfig,
  config: StatusConfig,
): { surface: Surface; segments: (string | SegmentConfig)[]; from: string; maxRows?: number } {
  // A preset fills in what was not written; it never overrides what was.
  const name = line.preset ?? config.preset ?? ""
  const named = PRESETS[name]
  const asked = line.surface ?? config.surface
  const surface: Surface = SURFACES.includes(asked ?? "")
    ? (asked as Surface)
    : (named?.surface ?? DEFAULT_SURFACE)
  /** No preset by a name that exists: the one for the surface, so the sidebar is never blank. */
  const presetName = named ? name : PRESET_FOR[surface]
  const preset = PRESETS[presetName]
  const written = line.segments ?? config.segments
  return {
    surface,
    segments: written ?? preset?.segments ?? DEFAULT_SEGMENTS,
    from: written ? '"segments"' : `the ${presetName} preset`,
    ...(preset?.maxRows !== undefined ? { maxRows: preset.maxRows } : {}),
  }
}

/** Normalises whatever the config said into the lines the renderer draws. */
export function resolveLines(config: StatusConfig): ResolvedLine[] {
  return lineSources(config).map(({ line }) => {
    const base = baseSegments(line, config)
    const surface = base.surface
    // The sidebar is a narrow column: across, it would be three truncated words.
    const stack = line.stack ?? config.stack ?? (surface === "sidebar" ? "vertical" : "horizontal")
    return {
      surface,
      segments: applyOverride(base.segments, line.override ?? config.override),
      separator: line.separator ?? config.separator ?? (stack === "vertical" ? "" : DEFAULT_SEPARATOR),
      stack,
      maxRows: line.maxRows ?? config.sidebarRows ?? base.maxRows ?? MAX_ROWS,
      icons: line.icons ?? config.icons ?? true,
      debug: line.debug ?? config.debug ?? false,
      paddingLeft: line.paddingLeft ?? config.paddingLeft ?? PADDING[surface].left,
      paddingRight: line.paddingRight ?? config.paddingRight ?? PADDING[surface].right,
      paddingTop: line.paddingTop ?? config.paddingTop ?? PADDING[surface].top,
      paddingBottom: line.paddingBottom ?? config.paddingBottom ?? PADDING[surface].bottom,
    }
  })
}

/** A segment written as a bare string is that built-in with no settings. */
export function asSegmentConfig(entry: string | SegmentConfig): SegmentConfig {
  return typeof entry === "string" ? { type: entry } : entry
}
