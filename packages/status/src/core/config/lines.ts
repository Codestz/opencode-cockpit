import {
  DEFAULT_SURFACE,
  isObject,
  type LineConfig,
  type SegmentChange,
  type SegmentConfig,
  type Stack,
  type StatusConfig,
  SURFACES,
  type Surface,
} from "./shape.ts"

export const isChange = (change: unknown): change is SegmentChange =>
  change === false || (typeof change === "string" && change.length > 0) || isObject(change)

export const segmentType = (entry: string | SegmentConfig) => (typeof entry === "string" ? entry : entry.type)

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
export function lineSources(config: StatusConfig): { line: LineConfig }[] {
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
export function baseSegments(
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
