/**
 * Where plugin entries live, and which of those files `opencode plugin -f` can rewrite.
 *
 * Checked against OpenCode 1.18.31 in a sandbox: `-g` edits the global `opencode.json(c)` and
 * `tui.json`; without it, the command writes `<worktree>/.opencode/`. It never edits a project's
 * root-level `opencode.jsonc` — over an old pin there it *adds* a second entry under `.opencode/`
 * and leaves the old one. Those files are marked `manual`: the updater shows the edit and never
 * makes it, because it does not write config files itself.
 */

import { join } from "node:path"
import type { Disk } from "./disk.ts"
import { parseJsonc } from "./jsonc.ts"
import { type PluginEntry, parseSpec, type Spec, specOf } from "./spec.ts"

export type Scope = "global" | "project"

export interface ConfigFile {
  path: string
  scope: Scope
  /** `command`: `opencode plugin -f` rewrites it. `manual`: only a person can. */
  owner: "command" | "manual"
  /** Where to run `opencode plugin` for this file. */
  cwd: string
}

export interface ConfigEntry {
  file: ConfigFile
  spec: Spec
}

export interface Where {
  env: Readonly<Record<string, string | undefined>>
  home: string
  /** The project's worktree root, when there is a project. */
  worktree?: string
}

const NAMES = ["opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc"]

export function globalConfigDir(where: Where): string {
  return join(where.env.XDG_CONFIG_HOME || join(where.home, ".config"), "opencode")
}

export function configFiles(where: Where): ConfigFile[] {
  const global = globalConfigDir(where)
  const files: ConfigFile[] = NAMES.map((name) => ({
    path: join(global, name),
    scope: "global",
    owner: "command",
    cwd: where.worktree ?? where.home,
  }))
  const root = where.worktree
  if (root && join(root, ".opencode") !== global) {
    for (const name of NAMES) {
      files.push({ path: join(root, ".opencode", name), scope: "project", owner: "command", cwd: root })
    }
    for (const name of NAMES) {
      files.push({ path: join(root, name), scope: "project", owner: "manual", cwd: root })
    }
  }
  return files
}

export interface ConfigRead {
  entries: ConfigEntry[]
  /** A file that exists and cannot be read is a failure, and a failure speaks. */
  errors: { path: string; message: string }[]
}

export function readConfigs(files: readonly ConfigFile[], disk: Disk): ConfigRead {
  const entries: ConfigEntry[] = []
  const errors: ConfigRead["errors"] = []
  for (const file of files) {
    const text = disk.read(file.path)
    if (text === undefined) continue
    const parsed = parseJsonc(text)
    if (!parsed.ok) {
      errors.push({ path: file.path, message: parsed.message })
      continue
    }
    const list = (parsed.value as { plugin?: unknown } | null)?.plugin
    if (list === undefined) continue
    if (!Array.isArray(list)) {
      errors.push({ path: file.path, message: '"plugin" is not a list' })
      continue
    }
    for (const entry of list as PluginEntry[]) {
      const raw = specOf(entry)
      if (raw) entries.push({ file, spec: parseSpec(raw) })
    }
  }
  return { entries, errors }
}
