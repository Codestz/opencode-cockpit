/**
 * Review's settings, through the loader every bay shares (`@opencode-cockpit/client/settings`):
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only the `review` section of a file is read. Before 0.9 Review read no file at all: its settings
 * existed only on the plugin entry in `tui.json`. A value Review does not know (`"variant": "left"`)
 * is a notice and the default, never a placement or a source that does not exist.
 */

import { baySettings, OPTIONS_SOURCE, type SettingsNotice } from "@opencode-cockpit/client/settings"
import type { Source } from "./model/review.ts"
import { VARIANTS, type Variant } from "./view/frame.ts"

const SOURCES: readonly Source[] = ["worktree", "branch"]

export interface ReviewConfig {
  /** Off switch for this bay, wherever it is written. `features.review: false` too. */
  enabled: boolean
  /** Which placement to open in: right | full. */
  variant: Variant
  /**
   * What to review on open: worktree | branch.
   *
   * Uncommitted by default, because that is what you are looking at nine times in ten — the work
   * that just happened. Branch is for reading a pull request, which is a thing you choose to do.
   */
  source: Source
  keybinds: Record<string, string>
}

export const DEFAULTS = { variant: "right" as Variant, source: "worktree" as Source }

export interface LoadedReview {
  config: ReviewConfig
  /** Settings to fix: an old name, a wrong kind, a value Review does not know. */
  notices: SettingsNotice[]
}

/** Reads and merges every source. Never throws. */
export function loadReview(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): LoadedReview {
  const loaded = baySettings("review", DEFAULTS, { options, where: { directory, env } })
  const notices = [...loaded.notices]
  /** Where the value in force was written: the entry's options win, then the last file that set it. */
  const own = (options ?? {}) as Record<string, Record<string, unknown> | undefined>
  const fileOf = (key: string): string => {
    const entry = typeof own.review === "object" && own.review !== null ? own.review : own
    if ((entry as Record<string, unknown>)[key] !== undefined) return OPTIONS_SOURCE
    const layer = [...loaded.settings.layers]
      .reverse()
      .find((each) => each.sections.review?.[key] !== undefined)
    return layer?.path ?? OPTIONS_SOURCE
  }
  /** One of the names it knows, or the default and a notice saying which names those are. */
  const known = <T extends string>(key: "variant" | "source", valid: readonly T[], fallback: T): T => {
    const value = loaded.config[key]
    if ((valid as readonly string[]).includes(value)) return value as T
    notices.push({
      bay: "review",
      file: fileOf(key),
      kind: "invalid",
      old: `review.${key}`,
      text: `"review.${key}" is "${value}"; it is one of ${valid.join(", ")} — "${fallback}" is used`,
    })
    return fallback
  }
  return {
    config: {
      enabled: loaded.config.enabled,
      variant: known("variant", VARIANTS, DEFAULTS.variant),
      source: known("source", SOURCES, DEFAULTS.source),
      keybinds: loaded.config.keybinds,
    },
    notices,
  }
}
