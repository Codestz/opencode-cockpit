/**
 * Status's agent side: no tools of its own, only the `status-setup` skill and its commands.
 *
 * `/status-setup` is shipped from here rather than registered by the interface so OpenCode runs it as
 * it runs its own commands: from home it opens a conversation, while the agent answers it waits its
 * turn — on both versions, with nothing of ours in between (docs/opencode/shipping-agents.md). The
 * line it sends names the skill; the skill calls `cockpit_settings` for what the files say now.
 *
 * Published entry point: `@opencode-cockpit/status/server`.
 */

import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { offerSettingsCheck } from "@opencode-cockpit/client/checks"
import { claimFeature } from "@opencode-cockpit/client/feature"
import { dualServer, type ServerStart } from "@opencode-cockpit/client/server"
import { offerPreview } from "@opencode-cockpit/client/setup"
import { statusNotices } from "./core/config.ts"
import { OLD_PROMPT, OLD_SLASH, SETUP_PROMPT, SETUP_SKILL_DIR, SETUP_SLASH } from "./core/setup.ts"

const STATUS_PACKAGE = "@opencode-cockpit/status"

/** The agent half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createStatusServer({ source = STATUS_PACKAGE }: { source?: string } = {}): ServerStart {
  return async (host) => {
    /** The bundle and this package side by side register the skill once, as the bays do. */
    const claim = claimFeature(host.scope, "status", source)
    if (!claim.active) return {}
    /** This copy's preview, by path: `cockpit_settings` hands it to the skill instead of `bunx`. */
    const here = dirname(fileURLToPath(import.meta.url))
    const preview = ["preview.js", "preview.ts"].map((file) => join(here, "cli", file)).find(existsSync)
    if (preview) offerPreview("status", `bun ${JSON.stringify(preview)}`)
    /** What Status's line warns about, so `cockpit_settings` says it too: presets, surfaces, overrides. */
    offerSettingsCheck("status", statusNotices)
    return {
      skills: [{ dir: SETUP_SKILL_DIR }],
      commands: [
        {
          name: SETUP_SLASH,
          description: "design the Status bay's line with the agent: what it shows, where",
          prompt: SETUP_PROMPT,
        },
        /**
         * The old name, for one release (removed in 0.10): a command of its own, because neither
         * OpenCode tells a command which of its names was typed, so only its own line can say it was
         * renamed — and it says so first, in the message the person sees in the conversation.
         */
        {
          name: OLD_SLASH,
          description: `renamed: use /${SETUP_SLASH}`,
          prompt: OLD_PROMPT,
        },
      ],
      dispose: () => claim.release(),
    }
  }
}

export default dualServer("opencode-cockpit.status", createStatusServer())
