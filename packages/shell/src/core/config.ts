import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { WatchRule } from "@opencode-cockpit/protocol/shell"

/**
 * Settings, read from one file so they are written once instead of twice (OpenCode keeps agent and
 * TUI plugins in separate configs). Precedence, lowest first:
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Everything is optional, and an unreadable or invalid file is ignored rather than fatal: a typo in
 * a config should never stop shells from working.
 */
export interface CockpitConfig {
  /** Health watching (see shell_watch). */
  watch?: {
    /** Attach a matching preset to every new shell without being asked. Off by default. */
    auto?: boolean
    /** Extra rules, or replacements for built-ins, keyed by preset name. */
    presets?: Record<string, WatchRule>
  }
  /** Extra shell kinds, or overrides, as name → regular expression matched against the command. */
  kinds?: Record<string, string>
  /** Applied to every shell the agent starts, unless the call says otherwise. */
  defaults?: {
    /** true/"auto", a preset name, or your own rule. */
    watch?: boolean | string | WatchRule
    logFile?: boolean
    idleTimeoutSeconds?: number
    timeoutSeconds?: number
    notifyOnExit?: boolean
  }
  /** What is allowed to interrupt the agent. */
  notify?: {
    exit?: boolean
    watch?: boolean
    /** Output lines included in an exit message. */
    tailLines?: number
  }
  /** The system-prompt guidance that teaches the agent to use shells (~120 tokens per request). */
  guidance?: boolean
  /** Running shells listed in the system prompt each turn; 0 disables (~20 tokens each). */
  listRunningShells?: number
  /** Interface options; also settable on the tui.json plugin entry. */
  ui?: {
    dockHeight?: number
    dockOpen?: boolean
    sidebarRows?: number
    historyMinutes?: number
    colors?: boolean
    defaultView?: "screen" | "log"
    keybinds?: Record<string, string>
    updateCheck?: boolean
  }
}

export const CONFIG_FILE = "config.json"
export const PROJECT_FILE = ".cockpit.json"

export function globalConfigPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config")
  return join(base, "opencode-cockpit", CONFIG_FILE)
}

/** Reads and merges every source. `options` is the plugin entry's own options object. */
export function loadConfig(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): CockpitConfig {
  return mergeConfig(
    mergeConfig(readConfigFile(globalConfigPath(env)), readConfigFile(join(directory, PROJECT_FILE))),
    asConfig(options),
  )
}

export function readConfigFile(path: string): CockpitConfig {
  if (!existsSync(path)) return {}
  try {
    return asConfig(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return {} // a broken config must not take shells down with it
  }
}

/** Section-wise merge: later sources win key by key, and never lose a whole section. */
export function mergeConfig(base: CockpitConfig, over: CockpitConfig): CockpitConfig {
  return {
    ...base,
    ...over,
    watch: { ...base.watch, ...over.watch, presets: { ...base.watch?.presets, ...over.watch?.presets } },
    kinds: { ...base.kinds, ...over.kinds },
    defaults: { ...base.defaults, ...over.defaults },
    notify: { ...base.notify, ...over.notify },
    ui: { ...base.ui, ...over.ui, keybinds: { ...base.ui?.keybinds, ...over.ui?.keybinds } },
  }
}

/**
 * Plugin-entry options were flat before the config file existed (`{ dockHeight: 16 }`), so those
 * keys still work and are read as `ui`.
 */
function asConfig(input: unknown): CockpitConfig {
  if (!input || typeof input !== "object") return {}
  const raw = input as Record<string, unknown>
  const config: CockpitConfig = {}
  for (const key of ["watch", "kinds", "defaults", "notify", "ui"] as const) {
    const value = raw[key]
    if (value && typeof value === "object") Object.assign(config, { [key]: value })
  }
  if (typeof raw.guidance === "boolean") config.guidance = raw.guidance
  if (typeof raw.listRunningShells === "number") config.listRunningShells = raw.listRunningShells

  const legacy: CockpitConfig["ui"] = {}
  for (const key of ["dockHeight", "dockOpen", "sidebarRows", "historyMinutes", "updateCheck"] as const) {
    if (raw[key] !== undefined) Object.assign(legacy, { [key]: raw[key] })
  }
  if (raw.keybinds && typeof raw.keybinds === "object")
    legacy.keybinds = raw.keybinds as Record<string, string>
  return Object.keys(legacy).length > 0 ? mergeConfig(config, { ui: legacy }) : config
}
