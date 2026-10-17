/**
 * Published entry point: `@opencode-cockpit/trust/server` — Trust's agent half.
 *
 * On OpenCode 2 it answers what Trust would answer before OpenCode makes a request at all, so no
 * prompt is drawn (agent/answer.ts); what it leaves, the interface answers as it always has. On
 * OpenCode 1 it has nothing of its own — v1 never calls a plugin before its prompt, so Trust answers
 * from the interface there, a frame after the prompt shows.
 *
 * It also exists because OpenCode 2 sets up a plugin's interface only once its agent half has loaded:
 * listed in `opencode.json`, as `opencode plugin add` writes it, a Trust with no agent half loaded
 * nothing at all (measured on 2.0.18). Like every Cockpit agent half, it offers `/cockpit-setup`.
 */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { dualServer, type ServerStart } from "@opencode-cockpit/client/server"
import { createAnswerer } from "./agent/answer.ts"
import { loadTrust, resolveSettings } from "./core/config.ts"
import { trustPaths } from "./core/paths.ts"
import { maskHasher } from "./tui/key.ts"

export const TRUST_PACKAGE = "@opencode-cockpit/trust"

/** Trust's agent half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createTrustServer({
  source = TRUST_PACKAGE,
  env = process.env,
}: {
  source?: string
  env?: Record<string, string | undefined>
} = {}): ServerStart {
  return async (host, rawOptions) => {
    if (host.version !== 2) return {}
    const claim = claimFeature(host.scope, "trust", source)
    if (!claim.active) {
      host.log.warn(duplicateFeatureMessage("Trust", claim.owner, source))
      return {}
    }
    const log = host.log.child("trust")
    const { config } = await loadTrust(host.directory, rawOptions, env)
    const settings = resolveSettings(config)
    if (!settings.enabled) {
      log.info("off in the settings")
      claim.release()
      return {}
    }
    const paths = trustPaths(host.directory, env)
    const answerer = createAnswerer({
      directory: host.directory,
      paths,
      settings,
      hash: maskHasher(paths, log),
      log,
    })
    return {
      toolBefore: (call) => answerer.toolBefore(call),
      permission: (request) => answerer.permission(request),
      dispose: () => claim.release(),
    }
  }
}

export default dualServer("opencode-cockpit.trust", createTrustServer())
