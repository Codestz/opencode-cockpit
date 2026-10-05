/**
 * Loading your own segments: importing each module the config names, and the fallback for a module
 * that lives outside a project. What a module is and where its path points is `core/custom.ts`.
 */

import { existsSync, rmSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { type CustomModule, type LoadResult, missingModule, resolveModulePath } from "../core/custom.ts"
import type { Pieces, SegmentDef } from "../core/segments.ts"

const DEFAULT_PRIORITY = 45

/** The specifier a module is written against, which is the whole point of the failure below. */
const AUTHORING = "@opencode-cockpit/status/segment"
/**
 * What the failure names. v1 says `Cannot find module '@opencode-cockpit/status/segment'`; v2 names
 * only the package — `Cannot find package '@opencode-cockpit/status'` — and matching the full
 * specifier left every module outside a project unloaded there.
 */
const AUTHORING_PACKAGE = "@opencode-cockpit/status"

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
/**
 * Status's own authoring module (core/authoring.ts), from a checkout or from a build.
 *
 * The specifier is a string argument rather than an import, so the build's `./x.ts` → `./x.js`
 * rewrite never touched it: published copies asked for a `.ts` that is not beside them and threw,
 * which took out the whole fallback and with it every module living outside a project. Ask for
 * both, in the order that keeps a checkout resolving to its source.
 */
function authoringModule(): string {
  for (const candidate of ["../core/authoring.ts", "../core/authoring.js"]) {
    try {
      return Bun.resolveSync(candidate, import.meta.dir)
    } catch {
      // try the other extension
    }
  }
  throw new Error("cannot find the statusline authoring module in core/")
}

async function importWithAuthoring(full: string): Promise<unknown> {
  const resolved = authoringModule()
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
        if (!message.includes(AUTHORING_PACKAGE)) throw err
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
      errors.push(
        `${path}: ${existsSync(full) ? (err instanceof Error ? err.message : String(err)) : missingModule(full)}`,
      )
    }
  }
  return { segments, errors }
}
