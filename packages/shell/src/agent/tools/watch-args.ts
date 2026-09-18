import type { WatchRule } from "@opencode-cockpit/protocol/shell"
import type { CockpitConfig } from "../../core/config.ts"

/**
 * Turns a preset name into what `shell.watch` needs. A preset defined in config is sent as an
 * explicit rule, so users can add tools or correct a built-in without touching the daemon.
 */
export function watchArgs(preset: string, config: CockpitConfig): { preset?: string; rule?: WatchRule } {
  const custom = config.watch?.presets?.[preset]
  return custom ? { rule: custom } : { preset }
}
