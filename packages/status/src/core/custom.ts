import { homedir } from "node:os"
import { basename, isAbsolute, resolve } from "node:path"
import type { SegmentConfig } from "./config/index.ts"
import type { StatusContext } from "./context.ts"
import type { Piece, Run, SegmentDef, Tone } from "./segments.ts"

/**
 * Your own segments, written in TypeScript.
 *
 * The declarative config covers the usual line and a shell command covers anything with a CLI, but
 * neither can read the session and decide. A module can: it is handed the same snapshot the
 * built-ins get, and what it returns is placed, coloured, prioritised and collapsed exactly like
 * one of them.
 *
 * A module default-exports its segments by name:
 *
 *   import type { StatusContext } from "@opencode-cockpit/status/segment"
 *
 *   export default {
 *     segments: {
 *       burn: (ctx: StatusContext) => {
 *         const mins = (ctx.now - (ctx.session?.startedAt ?? ctx.now)) / 60000
 *         if (!ctx.session?.priced || mins < 1) return undefined
 *         return { text: `$${(ctx.session.cost / mins).toFixed(2)}/min`, tone: "warning" }
 *       },
 *     },
 *   }
 *
 * and the name is then usable in the config like any built-in: `"segments": ["burn"]`.
 */

/** What a module's segment function is handed and what it may return. */
export type CustomRender = (
  ctx: StatusContext,
  config: SegmentConfig,
) => { text: string; tone?: Tone; color?: string } | { runs: Run[] } | Piece[] | string | undefined

export interface CustomModule {
  segments?: Record<string, CustomRender | { render: CustomRender; priority?: number }>
}

export interface LoadResult {
  segments: Map<string, SegmentDef>
  /** One line per module that could not be loaded, for a toast the user can act on. */
  errors: string[]
}

/** `~/x`, an absolute path, or one relative to the project. */
export function resolveModulePath(path: string, directory: string, home = homedir()): string {
  if (path.startsWith("~/")) return resolve(home, path.slice(2))
  if (isAbsolute(path)) return path
  return resolve(directory, path)
}

/**
 * The sidebar examples 0.9 removed when the `sidebar` preset became the table they built toward. A
 * config that still points at one in the package gets a sentence that says what replaced it, rather
 * than a resolver's stack of paths.
 */
const REMOVED_EXAMPLES = new Set(["sidebar.ts", "sidebar-full.ts", "sidebar-budget.ts"])

/** What a config pointing at one of them is told — in the brief, the log and the `!` row. */
export const REMOVED_EXAMPLE = `removed in 0.9: use "preset": "sidebar"`

/** What a module path that names no file is told: a removed example says what replaced it. */
export function missingModule(full: string): string {
  return REMOVED_EXAMPLES.has(basename(full)) ? REMOVED_EXAMPLE : "no file there"
}
