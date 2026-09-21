/**
 * OpenCode's plugin cache. Undocumented, inferred from disk, and certain to change — which is why
 * every assumption about its layout is in this one file.
 *
 * What 1.18.31 does: each spec is installed into `<cache>/packages/<spec>/`, a small project with
 * its own `package.json`, lock and `node_modules`. A scoped spec nests: `packages/@scope/name@1.0.0`.
 * The directory is reused for as long as it exists, which is the whole bug. `<cache>/version` holds
 * the layout's version; a different number means the rest of this file may be wrong.
 */

import { join } from "node:path"
import { type Disk, readJson } from "./disk.ts"
import { parseSpec } from "./spec.ts"

/** The layout this file was written against. */
export const KNOWN_LAYOUT = "18"

export function cacheRoot(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "opencode")
}

export function layoutVersion(disk: Disk, root: string): string | undefined {
  return disk.read(join(root, "version"))?.trim() || undefined
}

/**
 * The directory a spec is installed into. A bare name is installed as `name@latest` — the directory
 * that then never moves.
 */
export function specDir(root: string, spec: string): string {
  const parsed = parseSpec(spec)
  const dir = parsed.kind === "npm" && parsed.pin.type === "none" ? `${parsed.name}@latest` : spec
  return join(root, "packages", dir)
}

/** Every cache directory holding some spec of `name`: `name@0.3.0`, `name@latest`, … */
export function cacheDirsFor(disk: Disk, root: string, name: string): string[] {
  const slash = name.indexOf("/")
  const scope = name.startsWith("@") && slash > 0 ? name.slice(0, slash) : undefined
  const base = scope ? name.slice(slash + 1) : name
  const parent = scope ? join(root, "packages", scope) : join(root, "packages")
  return disk
    .list(parent)
    .filter((entry) => entry === base || entry.startsWith(`${base}@`))
    .map((entry) => join(parent, entry))
}

/** The version a spec's cache directory actually installed, whatever the spec says. */
export function installedVersion(disk: Disk, root: string, spec: string, name: string): string | undefined {
  const version = installedManifest(disk, root, spec, name)?.version
  return typeof version === "string" ? version : undefined
}

export interface Manifest {
  version?: unknown
  main?: unknown
  exports?: unknown
  "oc-themes"?: unknown
}

/** The `package.json` a spec's cache directory installed, if there is one. */
export function installedManifest(
  disk: Disk,
  root: string,
  spec: string,
  name: string,
): Manifest | undefined {
  const manifest = readJson(disk, join(specDir(root, spec), "node_modules", name, "package.json"))
  return manifest && typeof manifest === "object" ? (manifest as Manifest) : undefined
}

/**
 * Whether a package is something OpenCode will load as a plugin — its own rule, as `opencode plugin`
 * prints it when it refuses: `exports["./tui"]`, `exports["./server"]`, `main` for a server plugin, or
 * `oc-themes`. A package without any of them is a program with a similar name, and "updating" it
 * only ends in that refusal (seen with `opencode-worktree`, a command-line tool, listed as a plugin).
 */
export function isPluginManifest(manifest: Manifest): boolean {
  const exports = manifest.exports
  const has = (key: string) =>
    typeof exports === "object" && exports !== null && key in (exports as Record<string, unknown>)
  return (
    has("./tui") ||
    has("./server") ||
    typeof manifest.main === "string" ||
    manifest["oc-themes"] !== undefined
  )
}

/**
 * The version of the copy that is running, from the module path OpenCode resolved.
 *
 * Walks up from `target` to the first `package.json` that names the plugin. A spec says what was
 * asked for; this says what was got.
 */
export function runningVersion(disk: Disk, target: string, name: string): string | undefined {
  let dir = target.replace(/\/+$/, "")
  while (dir) {
    const manifest = readJson(disk, join(dir, "package.json")) as
      | { name?: unknown; version?: unknown }
      | undefined
    if (manifest?.name === name && typeof manifest.version === "string") return manifest.version
    const parent = dir.slice(0, dir.lastIndexOf("/"))
    if (parent === dir) break
    dir = parent
  }
  return undefined
}
