/**
 * What the statusline is actually doing right now, as data.
 *
 * The bay's own rule is that a segment with nothing to say says nothing, which is right on screen
 * and leaves exactly one question unanswerable from the screen itself: is this line quiet because
 * there is nothing to report, or because the config never arrived? This is the answer — which files
 * were read, which surfaces are drawing, how many segments each carries, and what a module did when
 * it failed to load. The `/statusline` command draws it; it lives here because it is a pure
 * function of the settings, and so can be tested without a terminal.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { globalConfigPath, PROJECT_FILE, type ResolvedLine } from "./config.ts"

export interface ReportLine {
  surface: string
  stack: string
  segments: number
  /** Vertical lines only: the cap that decides which rows survive. */
  maxRows?: number
}

export interface StatusReport {
  version: string
  /** Every config file the settings could have come from, in merge order, and whether it exists. */
  sources: { path: string; found: boolean }[]
  lines: ReportLine[]
  modules: {
    /** Paths listed in `modules`, as written. */
    listed: string[]
    /** Segments those modules actually registered. */
    registered: number
    /** One per module that would not load, already phrased for a human. */
    errors: string[]
  }
}

export interface ReportInput {
  version: string
  directory: string
  lines: readonly ResolvedLine[]
  modules?: readonly string[]
  registered: number
  errors: readonly string[]
  env?: Record<string, string | undefined>
}

export function buildReport(input: ReportInput): StatusReport {
  const global = globalConfigPath(input.env ?? process.env)
  const project = join(input.directory, PROJECT_FILE)
  return {
    version: input.version,
    sources: [global, project].map((path) => ({ path, found: existsSync(path) })),
    lines: input.lines.map((line) => ({
      surface: line.surface,
      stack: line.stack,
      segments: line.segments.length,
      maxRows: line.stack === "vertical" ? line.maxRows : undefined,
    })),
    modules: {
      listed: [...(input.modules ?? [])],
      registered: input.registered,
      errors: [...input.errors],
    },
  }
}

/**
 * The one sentence a report is worth opening for: whether anything is drawing at all, and if not,
 * the likeliest reason given what was found.
 */
export function reportHeadline(report: StatusReport): string {
  if (report.modules.errors.length > 0) {
    const count = report.modules.errors.length
    return `${count} module${count === 1 ? "" : "s"} failed to load — segments from ${count === 1 ? "it" : "them"} are missing`
  }
  if (report.lines.length === 0) return "Nothing is drawing: no line is configured"
  if (report.sources.every((source) => !source.found)) {
    return "Drawing the defaults — neither config file exists yet"
  }
  const rows = report.lines.reduce((sum, line) => sum + line.segments, 0)
  const where = [...new Set(report.lines.map((line) => line.surface))].join(" and ")
  return `${rows} segment${rows === 1 ? "" : "s"} across the ${where}`
}
