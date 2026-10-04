/**
 * Which bays are installed.
 *
 * The agent side cannot see the interface's plugins (OpenCode 2 runs them in another process, and
 * OpenCode 1 in another thread), and three bays have no agent side. So "installed" is read where the
 * person wrote it — OpenCode's own plugin lists — and "running here" from this side's claims.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { parseJsonc } from "../jsonc.ts"
import { baysOfEntry, pluginEntries } from "../plugin-entries.ts"
import type { Bay } from "../settings.ts"

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** OpenCode's config folders: the global one, the project, the project's `.opencode`. */
export const opencodeDirs = (
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string[] => [
  join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode"),
  directory,
  join(directory, ".opencode"),
]

/** A Cockpit plugin entry found in one of OpenCode's files. */
export interface Install {
  /** As written: `opencode-cockpit@0.9.0`, a path… */
  entry: string
  bundle: boolean
  file: string
  options?: unknown
}

/** OpenCode's files that list plugins: the agent side's and the interface's, global then project. */
export function opencodeConfigPaths(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  const names = ["opencode", opencode === 1 ? "tui" : "cli"]
  return opencodeDirs(directory, env, home).flatMap((dir) =>
    names.flatMap((name) => [join(dir, `${name}.json`), join(dir, `${name}.jsonc`)]),
  )
}

export function readInstalls(path: string, text: string | undefined): Install[] {
  if (text === undefined) return []
  const parsed = parseJsonc(text)
  if (!parsed.ok || !isObject(parsed.value)) return []
  return pluginEntries(parsed.value).flatMap(({ name, options }) => {
    const bays = baysOfEntry(name)
    if (bays.length === 0) return []
    return [
      { entry: name, bundle: bays.length > 1, file: path, ...(options !== undefined ? { options } : {}) },
    ]
  })
}

/** One bay's options in an entry: the bundle's section for it, else a single bay's own options. */
export function entryOptions(bay: Bay, install: Install): Record<string, unknown> | undefined {
  if (!isObject(install.options)) return undefined
  if (!install.bundle) return install.options
  const own = install.options[bay]
  return isObject(own) ? own : undefined
}
