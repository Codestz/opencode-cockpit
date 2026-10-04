/**
 * Cockpit's entries in OpenCode's plugin lists: one reader for `/cockpit-setup` and doctor, so the two
 * never disagree about what is installed.
 *
 * Node APIs only — doctor runs it under `npx`.
 */

import { basename } from "node:path"
import { BAYS, type Bay, isBay } from "./settings.ts"

/** The bundle's package, and the prefix every single bay's package carries. */
export const BUNDLE = "opencode-cockpit"
const SCOPE = "@opencode-cockpit/"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Every plugin entry in a config file, as either version writes it: v1's `"spec"` and
 * `["spec", options]` under `plugin`, v2's `"spec"` and `{ package, options }` under `plugins`. Anything
 * but an object has none.
 */
export function pluginEntries(config: unknown): { name: string; options?: unknown }[] {
  if (!isObject(config)) return []
  const lists = [config.plugin, config.plugins].filter(Array.isArray) as unknown[][]
  return lists.flat().flatMap((entry) => {
    if (typeof entry === "string") return [{ name: entry }]
    if (Array.isArray(entry) && typeof entry[0] === "string") return [{ name: entry[0], options: entry[1] }]
    if (isObject(entry) && typeof entry.package === "string")
      return [{ name: entry.package, options: entry.options }]
    return []
  })
}

/** The package a name is, when it is one of ours: `opencode-cockpit`, `@opencode-cockpit/shell`… */
export function bayOf(name: string | undefined): Bay | "bundle" | undefined {
  if (name === BUNDLE) return "bundle"
  const match = /^@opencode-cockpit\/([a-z]+)$/.exec(name ?? "")
  return match && isBay(match[1]) ? match[1] : undefined
}

/** The bays one entry brings, by its package — a name with or without a version, or a path. */
export function baysOfEntry(name: string): Bay[] {
  const path = name.replaceAll("\\", "/").replace(/\/+$/, "")
  const scoped = path.lastIndexOf(SCOPE)
  const pkg =
    scoped >= 0
      ? `${SCOPE}${path.slice(scoped + SCOPE.length).replace(/@.*$/, "")}`
      : basename(path).replace(/@[^/]*$/, "")
  const bay = bayOf(pkg)
  return bay === "bundle" ? [...BAYS] : bay ? [bay] : []
}
