import { baySettings, type SettingsNotice } from "@opencode-cockpit/client/settings"
import type { WatchRule } from "@opencode-cockpit/protocol/shell"

/**
 * Shell's settings, through the loader every bay shares (`@opencode-cockpit/client/settings`), read
 * by both halves so they are written once instead of twice (OpenCode keeps agent and TUI plugins in
 * separate configs). Precedence, lowest first:
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only the `shell` section of a file is read. Shell's keys used to sit at the file's root, with the
 * interface's under `ui`; those are no longer read, and each one found is a notice naming the new
 * place (drawn in the Shells block, and by doctor). Everything is optional, and an unreadable or
 * invalid file is ignored rather than fatal: a typo in a config should never stop shells from working.
 */
export interface ShellConfig {
  /** Off switch for this bay, both halves, wherever it is written. `features.shell: false` too. */
  enabled?: boolean
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
  /** When shells end by themselves. */
  lifecycle?: {
    /**
     * What happens to this window's shells when it closes. `stopMine` stops them, `keep` leaves
     * them running for the next window — which is how shells survive an OpenCode restart.
     */
    onExit?: "stopMine" | "keep"
    /** Stop a shell after this long with no window of its own connected. `0` never does. */
    orphanAfterMinutes?: number
    /**
     * Remove a shell the agent started this long after it exits cleanly (exit 0). Failed or killed
     * shells stay until cleared. Default 30; `0` keeps every finished shell.
     */
    removeFinishedAfterMinutes?: number
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
  /** The panel at the foot of the window: its height in rows (at most 45% of the window). */
  dockHeight?: number
  /** Whether the panel starts open; unset, it starts as you last left it. */
  dockOpen?: boolean
  /** Draw the Shells block in the sidebar; the dock and console stay either way. */
  sidebar?: boolean
  /** Shells in the sidebar before the rest fold into `+ N more`. */
  sidebarRows?: number
  /** Draw no Shells block at all while there are none. Default false: the heading and `none yet`. */
  hideWhenEmpty?: boolean
  /** Minutes a finished shell stays in the folded views after it ends. Was `ui.historyMinutes`. */
  hideFinishedAfterMinutes?: number
  /** Paint the colours programs print. */
  colors?: boolean
  /** What the console opens on: the program's screen, or its clean log. */
  defaultView?: "screen" | "log"
  keybinds?: Record<string, string>
}

/** What every source left unset becomes. Their kinds are what a written value is checked against. */
export const DEFAULTS = {
  guidance: true,
  listRunningShells: 15,
  dockHeight: 14,
  hideFinishedAfterMinutes: 30,
  colors: true,
  defaultView: "screen" as "screen" | "log",
  watch: {} as NonNullable<ShellConfig["watch"]>,
  kinds: {} as Record<string, string>,
  defaults: {} as NonNullable<ShellConfig["defaults"]>,
  lifecycle: {} as NonNullable<ShellConfig["lifecycle"]>,
  notify: {} as NonNullable<ShellConfig["notify"]>,
}

export interface LoadedShell {
  /** Every source merged over the defaults. */
  config: ShellConfig
  /** The block's place, from the top-level `sidebar` list. */
  order: number
  /** Settings to fix, for a `!` row in the block. */
  notices: SettingsNotice[]
}

/** Reads and merges every source. `options` is the plugin entry's own options object. Never throws. */
export function loadShell(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): LoadedShell {
  const loaded = baySettings("shell", DEFAULTS, { options, where: { directory, env } })
  const config = loaded.config as ShellConfig & typeof loaded.config
  /** A value outside the two the console knows is the default, not a third view. */
  if (config.defaultView !== "screen" && config.defaultView !== "log") config.defaultView = "screen"
  if (config.dockOpen !== undefined && typeof config.dockOpen !== "boolean") delete config.dockOpen
  return { config, order: loaded.order, notices: loaded.notices }
}

/** Every source merged over the defaults: what the agent's half reads. */
export function loadConfig(
  directory: string,
  options?: unknown,
  env: Record<string, string | undefined> = process.env,
): ShellConfig {
  return loadShell(directory, options, env).config
}
