/**
 * The preview's settings and drawing, apart from the terminal it prints to, so a test can hold the
 * preview to the rule that matters most: it draws what OpenCode will. An agent setting the table up
 * once previewed a file that said `"preset": "sidebar"` and was shown a line under the prompt, with
 * `sidebarRows: 14` capped at 8 — and could not tell whether the preview or the setting was wrong.
 */

import { type SettingsWhere, settingsPaths } from "@opencode-cockpit/client/settings"
import type { Budget } from "./budget.ts"
import {
  asSegmentConfig,
  configNotices,
  type LoadedStatus,
  loadStatus,
  type ResolvedLine,
  resolveLines,
  type Surface,
} from "./config.ts"
import type { StatusContext } from "./context.ts"
import { noticeRows } from "./notices.ts"
import { fit, fitColumn } from "./render.ts"
import { buildSegments, MARK, type SegmentDef, segmentWidth } from "./segments.ts"
import type { Run } from "./types.ts"

/** The flags `preview` takes: those with a value, and the switches. */
const VALUED = ["config", "as", "proxy", "module", "state", "width", "surface"] as const
const SWITCHES = ["with-config", "debug", "watch", "help"] as const

export interface PreviewArgs {
  values: Partial<Record<(typeof VALUED)[number], string>>
  switches: Set<(typeof SWITCHES)[number]>
  /** What could not be read: an unknown flag, a flag missing its value, a surface that is not one. */
  errors: string[]
}

/**
 * `--config path` and `--config=path` alike. An unknown flag is an error rather than ignored: a flag
 * the preview quietly dropped drew the user's own settings in place of the file it was handed.
 */
export function parseArgs(argv: readonly string[]): PreviewArgs {
  const out: PreviewArgs = { values: {}, switches: new Set(), errors: [] }
  const args = argv.filter((arg) => arg !== "preview")
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string
    if (!arg.startsWith("--")) {
      out.errors.push(`"${arg}" is not a flag — try --help`)
      continue
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined]
    if ((SWITCHES as readonly string[]).includes(name)) {
      out.switches.add(name as (typeof SWITCHES)[number])
    } else if ((VALUED as readonly string[]).includes(name)) {
      const value = inline ?? args[++index]
      if (value === undefined || (inline === undefined && value.startsWith("--"))) {
        out.errors.push(`--${name} needs a value`)
        if (value !== undefined) index--
        continue
      }
      out.values[name as (typeof VALUED)[number]] = value
    } else out.errors.push(`no flag --${name} — try --help`)
  }
  const surface = out.values.surface
  if (surface !== undefined && surface !== "sidebar" && surface !== "bottom") {
    out.errors.push(`--surface is sidebar or bottom, not "${surface}"`)
  }
  const as = out.values.as
  if (as !== undefined && as !== "global" && as !== "project") {
    out.errors.push(`--as is global or project, not "${as}"`)
  }
  if (as !== undefined && out.values.config === undefined) out.errors.push("--as goes with --config")
  return out
}

/** Which of the two settings files a candidate stands in for. */
export type ConfigAs = "global" | "project"

export interface PreviewInput {
  directory: string
  env?: Record<string, string | undefined>
  /**
   * A config's text — a file's, or a candidate piped on stdin. Read through the same loader as the
   * TUI's, so its `status` section — comments, old names, `sidebarRows`, `override` and all — means
   * here exactly what it will mean in OpenCode.
   */
  configText?: string
  /**
   * The file `configText` is meant to become. Set, the text takes that file's place and the other file
   * is read as OpenCode reads it, so a project's candidate merges over the real global config. Unset,
   * the text stands alone in place of the global config, with no project file beside it.
   */
  as?: ConfigAs
  /** How the other file is read, with `as` — the disk, in the preview CLI. */
  readFile?: (path: string) => string | undefined
  /** Draw on this surface whatever the settings say. */
  surface?: Surface
}

export interface PreviewSettings {
  loaded: LoadedStatus
  lines: ResolvedLine[]
  /** The file the text stood in for, with `as`. */
  target?: string
}

/** The settings and the lines the TUI would draw from them: `loadStatus`, then `resolveLines`. */
export function previewSettings(input: PreviewInput): PreviewSettings {
  const env = input.env ? { env: input.env } : {}
  let where: SettingsWhere = { directory: input.directory, ...env }
  let target: string | undefined
  if (input.configText !== undefined && input.as) {
    const paths = settingsPaths({ directory: input.directory, ...env })
    target = input.as === "project" ? paths.project : paths.global
    const readFile = input.readFile
    if (!readFile) throw new Error("previewSettings: `as` reads the other file, so it needs readFile")
    where = { ...where, read: (path) => (path === target ? input.configText : readFile(path)) }
  } else if (input.configText !== undefined) {
    // With no `directory` the loader asks for one file, the global one: this is it.
    where = { ...env, read: () => input.configText }
  }
  const loaded = loadStatus({ where })
  const at = target ? { target } : {}
  if (!input.surface) return { loaded, lines: resolveLines(loaded.config), ...at }
  /** Moved, a line starts from another preset: its notices are the moved line's, as they would be. */
  const config = forced(loaded.config, input.surface)
  const before = new Set(configNotices(loaded.config))
  const notices = [...loaded.notices.filter((notice) => !before.has(notice)), ...configNotices(config)]
  return { loaded: { ...loaded, notices }, lines: resolveLines(config), ...at }
}

/** `--surface`: every line on that surface, the way `"surface"` in the file would put it. */
function forced(config: LoadedStatus["config"], surface: Surface | undefined): LoadedStatus["config"] {
  if (!surface) return config
  return {
    ...config,
    surface,
    ...(config.lines ? { lines: config.lines.map((line) => ({ ...line, surface })) } : {}),
  }
}

/** What a sidebar is in OpenCode at a usual window size: a preview no wider than the real thing. */
export const SIDEBAR_WIDTH = 34

/** The room a line has: `--width`, else the sidebar's, else the terminal's less the padding. */
export const roomFor = (line: ResolvedLine, terminal: number, width?: number): number =>
  width && width > 0
    ? width
    : line.surface === "sidebar"
      ? SIDEBAR_WIDTH
      : terminal - line.paddingLeft - line.paddingRight

export interface DrawInput {
  lines: readonly ResolvedLine[]
  /** The `!` rows the bay would draw above its first sidebar line. */
  troubles: readonly string[]
  fixture: { ctx: StatusContext }
  terminal: number
  width?: number
  debug: boolean
  custom?: ReadonlyMap<string, SegmentDef>
  budget?: Budget
  /** Runs to text: ANSI colour for a terminal, the plain text otherwise. */
  paint: (runs: readonly Run[]) => string
  dim: (text: string) => string
}

/**
 * One state, every line, as the TUI fits it. With `debug`, every row says where it came from:
 * `✓git` beside a row that drew, `✗todo` in place of one that ran and said nothing, `?gti` for a
 * name nothing answers to — glyphs rather than colour, so they read the same piped into a file.
 */
export function drawState(input: DrawInput): string[] {
  const out: string[] = []
  const noticeLine = input.lines.find((line) => line.surface === "sidebar") ?? input.lines[0]
  for (const line of input.lines) {
    const room = roomFor(line, input.terminal, input.width)
    const ctx = { ...input.fixture.ctx, width: room, ...(input.budget ? { budget: input.budget } : {}) }
    if (line === noticeLine) {
      for (const row of noticeRows(input.troubles, room)) out.push(`  ${input.paint(row.runs).trimEnd()}`)
    }
    const built = buildSegments(ctx, line.segments.map(asSegmentConfig), {
      ...(input.custom ? { custom: input.custom } : {}),
      icons: line.icons,
      debug: input.debug,
    })
    const vertical = line.stack === "vertical"
    const fitted = vertical ? fitColumn(built, room, line.maxRows) : fit(built, room, line.separator)
    if (fitted.segments.length === 0) {
      out.push(`  ${input.dim(`(${line.surface}: nothing to draw)`)}`)
      continue
    }
    out.push(`  ${input.dim(`${line.surface}, ${room} cols`)}`)
    const named = (id: string) => `${MARK.drew}${id.replace(/#\d+$/, "")}`
    if (vertical) {
      for (const segment of fitted.segments) {
        const row = input.paint(segment.runs)
        if (!input.debug || segment.marker) out.push(`  ${row}`.trimEnd())
        else
          out.push(
            `  ${row}${" ".repeat(Math.max(1, room - segmentWidth(segment) + 2))}${input.dim(named(segment.id))}`,
          )
      }
    } else {
      out.push(
        `  ${fitted.segments.map((segment) => input.paint(segment.runs)).join(input.dim(line.separator))}`,
      )
      if (input.debug && fitted.segments.some((segment) => !segment.marker)) {
        const marks = fitted.segments.map((segment) =>
          segment.marker ? segmentText(segment) : named(segment.id),
        )
        out.push(`  ${input.dim(marks.join(" "))}`)
      }
    }
    /** Rows a real sidebar would have dropped — the TUI says `↳ N more` in their place. */
    if (fitted.dropped > 0) {
      const over = vertical ? `sidebarRows is ${line.maxRows}` : `${room} columns`
      out.push(`  ${input.dim(`↳ ${fitted.dropped} dropped — ${over}`)}`)
    }
    const widest = Math.max(0, ...fitted.segments.map(segmentWidth))
    if (vertical && widest > room)
      out.push(`  ${input.dim(`↳ widest row is ${widest} cols, the column has ${room}`)}`)
  }
  return out
}

const segmentText = (segment: { runs: readonly Run[] }) => segment.runs.map((run) => run.text).join("")

/** Plain text, for a pipe, NO_COLOR, and tests. */
export const plainRuns = (runs: readonly Run[]): string => runs.map((run) => run.text).join("")
