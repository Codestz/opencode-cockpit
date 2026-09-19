import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import type { SegmentConfig } from "./config.ts"
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
) => { text: string; tone?: Tone; color?: string } | { runs: Run[] } | string | undefined

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

const DEFAULT_PRIORITY = 45

export async function loadCustomSegments(
  paths: readonly string[],
  directory: string,
  importer: (path: string) => Promise<unknown> = (path) => import(path),
): Promise<LoadResult> {
  const segments = new Map<string, SegmentDef>()
  const errors: string[] = []

  for (const path of paths) {
    const full = resolveModulePath(path, directory)
    try {
      const loaded = (await importer(full)) as { default?: CustomModule } & CustomModule
      const module = loaded.default ?? loaded
      for (const [name, entry] of Object.entries(module.segments ?? {})) {
        const render = typeof entry === "function" ? entry : entry.render
        if (typeof render !== "function") {
          errors.push(`${path}: segment "${name}" is not a function`)
          continue
        }
        const priority = typeof entry === "function" ? DEFAULT_PRIORITY : (entry.priority ?? DEFAULT_PRIORITY)
        segments.set(name, {
          name,
          priority,
          render(ctx, config): Piece | undefined {
            const value = render(ctx, config)
            if (value === undefined) return undefined
            if (typeof value === "string") return value ? { text: value, tone: "muted" } : undefined
            if ("runs" in value) return value.runs.length > 0 ? value : undefined
            return value.text
              ? { text: value.text, tone: value.tone ?? "muted", color: value.color }
              : undefined
          },
        })
      }
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { segments, errors }
}
