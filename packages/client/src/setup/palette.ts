/** The interface: a palette entry that asks the agent to set Cockpit up. */

import { briefAgent } from "../brief.ts"
import { claimFeature } from "../feature.ts"
import type { Host } from "../host.ts"
import { SETUP_PROMPT } from "./names.ts"

/**
 * The palette entry, once per window. Neither OpenCode lists a command an agent side ships in its
 * palette (measured: `ctrl+p` → "cockpit" finds nothing), so the interface offers one that sends the
 * command's own line. No slash name: `/cockpit-setup` is the shipped command's, and a second
 * `/cockpit-setup` in the popup would be two rows doing one thing.
 */
export function registerSetup(host: Host, source: string): void {
  const claim = claimFeature(host.renderer, "setup", source)
  if (!claim.active) return
  host.lifecycle.onDispose(() => claim.release())
  host.keymap.registerLayer({
    commands: [
      {
        name: "cockpit.setup",
        title: "Ask the agent to set up Cockpit",
        desc: "which bays show, where, in what order",
        category: "Cockpit",
        namespace: "palette",
        run: () => {
          host.log.info("setup: asked from the palette")
          briefAgent(host, SETUP_PROMPT, "Cockpit setup")
        },
      },
    ],
  } as never)
}
