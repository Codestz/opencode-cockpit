/**
 * The Updater's one setting: whether to check once a day and say so.
 *
 * Read through the same files as every bay — `~/.config/opencode-cockpit/config.json`, then the
 * project's `.cockpit.json`, then plugin-entry options, later wins. `ui.updateCheck` is honoured
 * too: it is the switch Shell's own notice had, and someone who turned that off meant it.
 */

import { join } from "node:path"
import type { Disk } from "./disk.ts"
import { parseJsonc } from "./jsonc.ts"

type Section = { updateCheck?: unknown } | undefined

function fromFile(disk: Disk, path: string): boolean | undefined {
  const text = disk.read(path)
  if (text === undefined) return undefined
  const parsed = parseJsonc(text)
  if (!parsed.ok) return undefined // a broken config must not take the notice down with it
  const file = parsed.value as { updater?: Section; ui?: Section } | null
  const value = file?.updater?.updateCheck ?? file?.ui?.updateCheck
  return typeof value === "boolean" ? value : undefined
}

export function updateCheckEnabled(
  disk: Disk,
  where: { env: Readonly<Record<string, string | undefined>>; home: string; directory?: string },
  options: unknown,
): boolean {
  const base = where.env.XDG_CONFIG_HOME || join(where.home, ".config")
  const layers = [
    fromFile(disk, join(base, "opencode-cockpit", "config.json")),
    where.directory ? fromFile(disk, join(where.directory, ".cockpit.json")) : undefined,
    (options as Section)?.updateCheck,
  ]
  let enabled = true
  for (const layer of layers) if (typeof layer === "boolean") enabled = layer
  return enabled
}
