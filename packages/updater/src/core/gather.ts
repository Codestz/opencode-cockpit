/**
 * Everything the list needs, read from disk and the registry — the same way for the CLI, which has
 * no host, and the dialog, which also knows what the host loaded.
 */

import { join } from "node:path"
import {
  cacheDirsFor,
  cacheRoot,
  installedVersion,
  KNOWN_LAYOUT,
  layoutVersion,
  runningVersion,
} from "./cache.ts"
import { type ConfigFile, configFiles, readConfigs, type Where } from "./configs.ts"
import { type Disk, readJson } from "./disk.ts"
import { buildPlan, collectPlugins, type Listed, type PluginPlan } from "./plan.ts"
import { parseSpec } from "./spec.ts"

export interface GatherIo extends Where {
  disk: Disk
  fetchLatest(names: readonly string[]): Promise<Map<string, string | undefined>>
  /** What the host loaded, with the module path it resolved. Empty outside OpenCode. */
  listed?: readonly (Listed & { target?: string })[]
}

export interface Gathered {
  plans: PluginPlan[]
  /** Config files that exist and could not be read. */
  errors: { path: string; message: string }[]
  /** Said once, above the list. */
  warnings: string[]
  files: ConfigFile[]
  root: string
}

export async function gather(io: GatherIo): Promise<Gathered> {
  const files = configFiles(io)
  const read = readConfigs(files, io.disk)
  const root = cacheRoot(io.env, io.home)
  const listed = io.listed ?? []

  const plugins = collectPlugins(listed, read.entries).map((plugin) => {
    if (plugin.source === "file") {
      // A checkout has a name and a version too; "running" is as true of it as of anything from npm.
      const found = packageAt(io.disk, plugin.name)
      return {
        ...plugin,
        ...(found.name ? { label: found.name } : {}),
        ...(found.version ? { running: found.version } : {}),
      }
    }
    if (plugin.source !== "npm") return plugin
    const running = runningOf(io, root, plugin.name, listed, read.entries)
    return running === undefined ? plugin : { ...plugin, running }
  })
  const npm = plugins.filter((p) => p.source === "npm").map((p) => p.name)
  const published = await io.fetchLatest(npm)
  const cacheDirs = new Map(npm.map((name) => [name, cacheDirsFor(io.disk, root, name)]))
  let plans = buildPlan({ plugins, entries: read.entries, published, cacheDirs })

  // A layout this was not written against: still update the configs, but delete nothing.
  const warnings: string[] = []
  const layout = layoutVersion(io.disk, root)
  if (layout !== undefined && layout !== KNOWN_LAYOUT) {
    plans = plans.map((plan) => ({ ...plan, remove: [] }))
    warnings.push(
      `OpenCode's cache layout is ${layout}, not ${KNOWN_LAYOUT}: no cache directory will be removed.`,
    )
  }
  return { plans, errors: read.errors, warnings, files, root }
}

/** The `package.json` at a local plugin's path, or beside the file it points at. */
function packageAt(disk: Disk, path: string): { name?: string; version?: string } {
  for (const dir of [path, path.slice(0, path.lastIndexOf("/"))]) {
    const manifest = readJson(disk, join(dir, "package.json")) as
      | { name?: unknown; version?: unknown }
      | undefined
    if (typeof manifest?.name === "string") {
      return {
        name: manifest.name,
        ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
      }
    }
  }
  return {}
}

/**
 * What is running: the module the host resolved, when there is a host; otherwise what each spec's
 * cache directory installed, a project's spec before a global one.
 */
function runningOf(
  io: GatherIo,
  root: string,
  name: string,
  listed: readonly (Listed & { target?: string })[],
  entries: ReturnType<typeof readConfigs>["entries"],
): string | undefined {
  for (const item of listed) {
    const spec = parseSpec(item.spec)
    if (item.target && spec.kind === "npm" && spec.name === name) {
      const version = runningVersion(io.disk, item.target, name)
      if (version) return version
    }
  }
  const ordered = [...entries].sort((a, b) =>
    a.file.scope === b.file.scope ? 0 : a.file.scope === "project" ? -1 : 1,
  )
  for (const { spec } of ordered) {
    if (spec.kind !== "npm" || spec.name !== name) continue
    const version = installedVersion(io.disk, root, spec.raw, name)
    if (version) return version
  }
  return undefined
}
