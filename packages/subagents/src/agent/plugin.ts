import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { dualServer, type ServerStart } from "@opencode-cockpit/client/server"

/**
 * What the agent is told about subagents, once per request.
 *
 * Measured on both OpenCodes (docs/opencode/agents.md): a subagent launched in the background lets the
 * conversation carry on, and the main agent is told when it finishes. OpenCode 2 offers it on its
 * `subagent` tool; OpenCode 1 only with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`, which a
 * plugin cannot set — so the guidance says "if your tool offers it", and never promises it.
 */
export const GUIDANCE = `## Subagents (opencode-cockpit)
When you delegate independent work to a subagent, launch it with background: true if your task or subagent tool offers that option, so this conversation continues while it works; you are notified when it finishes. Work on something else meanwhile, or tell the user what you launched.
To follow up with a subagent, continue the same one (task_id or sessionID) instead of launching a new one.
The user can watch each subagent's thinking and tool calls, and can message it directly.`

export const SUBAGENTS_PACKAGE = "@opencode-cockpit/subagents"

export interface SubagentsServerOptions {
  source?: string
}

/** The agent side as a factory, so the `opencode-cockpit` bundle can include it. */
export function createSubagentsServer({
  source = SUBAGENTS_PACKAGE,
}: SubagentsServerOptions = {}): ServerStart {
  return async (host, rawOptions) => {
    const claim = claimFeature(host.scope, "subagents", source)
    if (!claim.active) {
      host.log.warn(duplicateFeatureMessage("Subagents", claim.owner, source))
      return {}
    }
    const options = (rawOptions ?? {}) as { guidance?: boolean }
    return {
      ...(options.guidance === false ? {} : { system: async () => [GUIDANCE] }),
      dispose: () => claim.release(),
    }
  }
}

export default dualServer("opencode-cockpit.subagents", createSubagentsServer())
