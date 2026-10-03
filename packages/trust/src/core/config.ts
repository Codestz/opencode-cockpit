/**
 * Trust's settings, through the loader every bay shares (`@opencode-cockpit/client/settings`):
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only the `trust` section of a file is read. A file without one says nothing about Trust — reading
 * the whole file as Trust's settings is the trap that page warns about. An unreadable or invalid file
 * is ignored rather than fatal, with a notice: a typo in a config should never cost you the interface.
 *
 * This is Cockpit's config, not OpenCode's. What OpenCode allows, denies and asks about is read from
 * OpenCode itself (`rules.ts`), and never written by Trust.
 */

import { baySettings, type SettingsNotice } from "@opencode-cockpit/client/settings"

export interface TrustConfig {
  /** Off switch for this bay, wherever it is written. The bundle also has `features.trust: false`. */
  enabled?: boolean
  /** Approvals in a row, by you, before Trust answers for you. Default 3. */
  threshold?: number
  /** What a dangerous command costs on top (`rm`, `git push`, `--force`…). Default 5: eight in all. */
  dangerExtra?: number
  /** Days a trusted command may go unused before it has to be earned again. Default 30; 0 never. */
  expireDays?: number
  /**
   * Whether Trust draws a block in the sidebar. Default false: the sidebar already carries the
   * statusline, subagents and shells, and Trust works the same without it — `/trust` opens the
   * ledger, and the palette's "Show or hide Trust in the sidebar" brings the block back for the session.
   * Where it sits is the top-level `sidebar` list's to say.
   */
  sidebar?: boolean
  /** Answers by Trust listed in the sidebar. Default 3. */
  sidebarRows?: number
  keybinds?: Record<string, string>
}

export interface TrustSettings {
  enabled: boolean
  threshold: number
  dangerExtra: number
  expireDays: number
  sidebar: boolean
  sidebarRows: number
}

export const DEFAULTS: TrustSettings = {
  enabled: true,
  threshold: 3,
  dangerExtra: 5,
  expireDays: 30,
  sidebar: false,
  sidebarRows: 3,
}

const KEYS = [
  "enabled",
  "threshold",
  "dangerExtra",
  "expireDays",
  "sidebar",
  "sidebarRows",
  "keybinds",
] as const

/** The `trust` section of a config file. */
export function trustSection(raw: unknown): TrustConfig {
  if (!raw || typeof raw !== "object") return {}
  const section = (raw as Record<string, unknown>).trust
  return section && typeof section === "object" ? pick(section as Record<string, unknown>) : {}
}

/**
 * Plugin-entry options: a whole cockpit config (`{ trust: {...} }`) or Trust's own keys, because the
 * bundle hands each bay its own section and a standalone entry carries them directly.
 */
export function asTrustConfig(input: unknown): TrustConfig {
  if (!input || typeof input !== "object") return {}
  const raw = input as Record<string, unknown>
  if (raw.trust && typeof raw.trust === "object") return pick(raw.trust as Record<string, unknown>)
  return pick(raw)
}

function pick(raw: Record<string, unknown>): TrustConfig {
  const own: TrustConfig = {}
  for (const key of KEYS) if (raw[key] !== undefined) Object.assign(own, { [key]: raw[key] })
  return own
}

export interface LoadedTrust {
  /** What was written, every source merged; `resolveSettings` fills the gaps. */
  config: TrustConfig
  /** The block's place, from the top-level `sidebar` list. */
  order: number
  /** Settings to fix, for a `!` row. */
  notices: SettingsNotice[]
}

/** Reads and merges every source. Never throws. */
export async function loadTrust(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedTrust> {
  const loaded = baySettings("trust", DEFAULTS, { options, where: { directory, env } })
  /** `features.trust: false` in a file turns Trust off as `enabled: false` does. */
  const off = loaded.config.enabled ? {} : { enabled: false }
  return { config: { ...pick(loaded.written), ...off }, order: loaded.order, notices: loaded.notices }
}

/** Every source merged, as written. */
export async function loadTrustConfig(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<TrustConfig> {
  return (await loadTrust(directory, options, env)).config
}

const whole = (value: unknown, fallback: number, least: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(least, Math.floor(value)) : fallback

/** Settings with every gap filled and every number made sensible: a threshold of 0 would trust anything. */
export function resolveSettings(config: TrustConfig): TrustSettings {
  return {
    enabled: config.enabled !== false,
    threshold: whole(config.threshold, DEFAULTS.threshold, 1),
    dangerExtra: whole(config.dangerExtra, DEFAULTS.dangerExtra, 0),
    expireDays: whole(config.expireDays, DEFAULTS.expireDays, 0),
    sidebar: config.sidebar === true,
    sidebarRows: whole(config.sidebarRows, DEFAULTS.sidebarRows, 0),
  }
}
