/**
 * What the statusline is actually doing right now, as data.
 *
 * The bay's own rule is that a segment with nothing to say says nothing, which is right on screen
 * and leaves exactly one question unanswerable from the screen itself: is this line quiet because
 * there is nothing to report, or because the config never arrived? This is the answer — which files
 * were read, which surfaces are drawing, how many segments each carries, what a module did when it
 * failed to load, and which settings are no longer read. `/status-setup` hands it to the agent; it
 * lives here because it is a pure function of the settings, and so can be tested without a terminal.
 */

import { existsSync } from "node:fs"
import { settingsPaths } from "@opencode-cockpit/client/settings"
import type { ResolvedLine } from "./config.ts"

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
  /** Settings to fix, as the `!` rows say them: an old name, a key nothing reads, a file that would not parse. */
  notices: string[]
}

export interface ReportInput {
  version: string
  directory: string
  /** The files the loader looked for, global first. Looked up again when not given. */
  files?: readonly { path: string; found: boolean }[]
  lines: readonly ResolvedLine[]
  modules?: readonly string[]
  registered: number
  errors: readonly string[]
  notices?: readonly string[]
  env?: Record<string, string | undefined>
}

export function buildReport(input: ReportInput): StatusReport {
  const env = input.env ?? process.env
  const paths = settingsPaths({ directory: input.directory, env, ...(env.HOME ? { home: env.HOME } : {}) })
  const sources =
    input.files?.map(({ path, found }) => ({ path, found })) ??
    [paths.global, paths.project ?? ""].map((path) => ({ path, found: existsSync(path) }))
  return {
    version: input.version,
    sources,
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
    notices: [...(input.notices ?? [])],
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
  if (report.notices.length > 0) {
    const count = report.notices.length
    return `${count} setting${count === 1 ? "" : "s"} to fix — the line draws without ${count === 1 ? "it" : "them"}`
  }
  if (report.sources.every((source) => !source.found)) {
    return "Drawing the defaults — neither config file exists yet"
  }
  const rows = report.lines.reduce((sum, line) => sum + line.segments, 0)
  const where = [...new Set(report.lines.map((line) => line.surface))].join(" and ")
  return `${rows} segment${rows === 1 ? "" : "s"} across the ${where}`
}
