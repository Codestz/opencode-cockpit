/**
 * Subagents' settings, through the loader every bay shares (`@opencode-cockpit/client/settings`):
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only the `subagents` section of a file is read, by both halves: the interface's keys and the
 * agent's `guidance` sit in one place instead of in `tui.json` and `opencode.json` apart. Before 0.9
 * the bay read no file at all. An old name (`hideFinishedAfter`, `hideNestedAfter`, `sidebarOrder`)
 * is not read; it is a notice naming the new one, drawn in the Subagents block.
 */

import { baySettings, type SettingsNotice } from "@opencode-cockpit/client/settings"

export interface SubagentsConfig {
  /** Off switch for this bay, both halves, wherever it is written. `features.subagents: false` too. */
  enabled?: boolean
  /** Subagents shown in the sidebar before the rest fold into `+ N more`. Default 6. */
  sidebarRows?: number
  /** Draw no Subagents block at all while there are none. Default false: the heading and `none yet`. */
  hideWhenEmpty?: boolean
  /**
   * Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation. It is only
   * out of the sidebar — `/subagents` and the pane's `[` `]` still reach it, and it comes back if it
   * works again.
   */
  hideFinishedAfterMinutes?: number
  /**
   * Seconds a finished *nested* subagent — one a subagent launched, an advisor it asks again and
   * again — stays in the sidebar; 30 unless set, a negative number keeps them. As with
   * `hideFinishedAfterMinutes` it is only out of the sidebar: the heading still counts it and the
   * pane's `[` `]` still reach it. Seconds, because these come and go in seconds.
   */
  hideNestedAfterSeconds?: number
  /** The system-prompt guidance that teaches the agent to follow, wait on and read its subagents. */
  guidance?: boolean
  keybinds?: Record<string, string>
}

/** What every source left unset becomes; a written value of another kind is dropped, with a notice. */
export const DEFAULTS = {
  guidance: true,
  hideNestedAfterSeconds: 30,
  /** Unset keeps finished ones: a number only when written. */
  hideFinishedAfterMinutes: undefined as number | undefined,
}

export interface LoadedSubagents {
  config: SubagentsConfig & { sidebarRows: number; hideWhenEmpty: boolean; enabled: boolean }
  /** The block's place, from the top-level `sidebar` list. */
  order: number
  /** Settings to fix, for a `!` row in the block. */
  notices: SettingsNotice[]
}

/** Reads and merges every source. Never throws. */
export function loadSubagents(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): LoadedSubagents {
  const loaded = baySettings("subagents", DEFAULTS, { options, where: { directory, env } })
  const config: LoadedSubagents["config"] = { ...loaded.config }
  /** Undefined has no kind to check against: anything but a number there means "keep them". */
  if (typeof config.hideFinishedAfterMinutes !== "number") delete config.hideFinishedAfterMinutes
  return { config, order: loaded.order, notices: loaded.notices }
}
