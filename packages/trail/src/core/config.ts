/**
 * Trail's settings, through the loader every bay shares (`@opencode-cockpit/client/settings`):
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only the `trail` section is read, and Trail has nothing of its own beyond the keys every bay shares:
 * `enabled`, `sidebar` (on by default — Gate 1: a core piece, present like Shells and Subagents),
 * `sidebarRows`, `hideWhenEmpty` and `keybinds`. Where the block sits is the top-level `sidebar`
 * list's to say. Both halves read it: the agent half for `enabled`, the interface for the rest.
 */

import { baySettings, noticeText, type SettingsWhere } from "@opencode-cockpit/client/settings"

export interface TrailSettings {
  enabled: boolean
  /** Draw the block in the sidebar. */
  sidebar: boolean
  /** Records listed before `+ N more · /trail`. */
  sidebarRows: number
  /** Draw no block at all while this conversation's trail is empty. */
  hideWhenEmpty: boolean
  keybinds: Record<string, string>
}

export interface LoadedTrail {
  settings: TrailSettings
  /** The block's `order`, from the top-level `sidebar` list. */
  order: number
  /** Settings to fix, as the sentences a `!` row says. */
  notices: string[]
}

/** Every source merged, with the client's defaults. Never throws: a bad file is a notice. */
export function loadTrail(directory: string, options?: unknown, where: SettingsWhere = {}): LoadedTrail {
  const { config, order, notices } = baySettings("trail", {}, { options, where: { directory, ...where } })
  return {
    settings: {
      enabled: config.enabled,
      sidebar: config.sidebar,
      sidebarRows: Math.max(1, config.sidebarRows),
      hideWhenEmpty: config.hideWhenEmpty,
      keybinds: config.keybinds,
    },
    order,
    notices: notices.map(noticeText),
  }
}
