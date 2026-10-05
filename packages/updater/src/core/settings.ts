/**
 * The Updater's one setting: whether to check once a day and say so — `updater.updateCheck`.
 *
 * Read through the loader every bay reads with (`@opencode-cockpit/client/settings`):
 * `~/.config/opencode-cockpit/config.json`, then the project's `.cockpit.json`, then plugin-entry
 * options, later wins. `ui.updateCheck`, the switch Shell's own notice had, is not read.
 */

import { baySettings, type SettingsNotice } from "@opencode-cockpit/client/settings"
import type { Disk } from "./disk.ts"

export interface UpdateCheckWhere {
  env: Readonly<Record<string, string | undefined>>
  home: string
  directory?: string
}

/** The setting, and what about it is worth fixing. A broken file is a notice, never the end of the check. */
export function updateCheck(
  disk: Disk,
  where: UpdateCheckWhere,
  options: unknown,
): { enabled: boolean; notices: SettingsNotice[] } {
  const loaded = baySettings(
    "updater",
    { updateCheck: true },
    {
      options,
      where: {
        env: where.env,
        home: where.home,
        ...(where.directory ? { directory: where.directory } : {}),
        read: (path) => disk.read(path),
      },
    },
  )
  return { enabled: loaded.config.enabled && loaded.config.updateCheck, notices: loaded.notices }
}

export function updateCheckEnabled(disk: Disk, where: UpdateCheckWhere, options: unknown): boolean {
  return updateCheck(disk, where, options).enabled
}
