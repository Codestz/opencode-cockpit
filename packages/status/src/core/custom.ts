import { rmSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { SegmentConfig } from "./config.ts"
import type { StatusContext } from "./context.ts"
import type { Piece, Pieces, Run, SegmentDef, Tone } from "./segments.ts"

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

const DEFAULT_PRIORITY = 45

/** The specifier a module is written against, which is the whole point of the failure below. */
const AUTHORING = "@opencode-cockpit/status/segment"

/**
 * Loading a module that lives outside a project.
 *
 * A statusline module belongs next to the config it serves, and the natural home for that is
 * `~/.config/opencode-cockpit/`. But a bare import resolves from the importing file's own
 * directory, and a config directory has no `node_modules` -- so every example in our own README
 * fails for exactly the people the README is written for, and its segments vanish from the line
 * with only a start-up toast to say why.
 *
 * The specifier resolves perfectly well from *this* file, so the fallback rewrites it to that
 * resolved path and imports a copy placed beside the original, where the module's own relative
 * imports still work. Only on failure: a module inside a project that installed the bay never
 * takes this path.
 */
async function importWithAuthoring(full: string): Promise<unknown> {
  const resolved = Bun.resolveSync("./authoring.ts", import.meta.dir)
  const source = await Bun.file(full).text()
  const patched = source.replaceAll(AUTHORING, pathToFileURL(resolved).href)
  if (patched === source) throw new Error(`does not import ${AUTHORING}`)

  // Beside the original, so `./helpers.ts` next to a module keeps resolving.
  const shim = join(dirname(full), `.${basename(full, extname(full))}.cockpit.${extname(full).slice(1)}`)
  try {
    await Bun.write(shim, patched)
    return await import(`${shim}?t=${Date.now()}`)
  } finally {
    rmSync(shim, { force: true })
  }
}

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
      let loaded: { default?: CustomModule } & CustomModule
      try {
        loaded = (await importer(full)) as { default?: CustomModule } & CustomModule
      } catch (err) {
        // Only the one failure is worth retrying; anything else is the module's own problem.
        const message = err instanceof Error ? err.message : String(err)
        if (!message.includes(AUTHORING)) throw err
        loaded = (await importWithAuthoring(full)) as { default?: CustomModule } & CustomModule
      }
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
          render(ctx, config): Pieces | undefined {
            const value = render(ctx, config)
            if (value === undefined) return undefined
            // Several rows: each is drawn on its own, and empty ones are left out.
            if (Array.isArray(value)) return value.length > 0 ? value : undefined
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
