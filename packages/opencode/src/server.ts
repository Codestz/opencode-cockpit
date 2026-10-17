import { composeParts, dualServer } from "@opencode-cockpit/client/server"
import { createReviewServer } from "@opencode-cockpit/review/server"
import { createShellServer } from "@opencode-cockpit/shell/server"
import { createStatusServer } from "@opencode-cockpit/status/server"
import { createSubagentsServer } from "@opencode-cockpit/subagents/server"
import { createTrailServer } from "@opencode-cockpit/trail/server"
import { createTrustServer } from "@opencode-cockpit/trust/server"
import { BUNDLE, type CockpitOptions, featureOptions, isEnabled } from "./features.ts"

const shell = createShellServer({ source: BUNDLE })
const status = createStatusServer({ source: BUNDLE })
const review = createReviewServer({ source: BUNDLE })
const subagents = createSubagentsServer({ source: BUNDLE })
const trail = createTrailServer({ source: BUNDLE })
const trust = createTrustServer({ source: BUNDLE })

export default dualServer(BUNDLE, async (host, rawOptions) => {
  const options = rawOptions as CockpitOptions | undefined
  const parts = []
  if (isEnabled(options, "shell")) parts.push(await shell(host, featureOptions(options, "shell")))
  /** Status's agent side is its `status-setup` skill and commands; the line itself is all interface. */
  if (isEnabled(options, "status")) parts.push(await status(host, featureOptions(options, "status")))
  if (isEnabled(options, "review")) parts.push(await review(host, featureOptions(options, "review")))
  if (isEnabled(options, "subagents")) parts.push(await subagents(host, featureOptions(options, "subagents")))
  if (isEnabled(options, "trail")) parts.push(await trail(host, featureOptions(options, "trail")))
  /** On OpenCode 2, Trust answers before a prompt is drawn (trust/src/agent/answer.ts). */
  if (isEnabled(options, "trust")) parts.push(await trust(host, featureOptions(options, "trust")))
  return composeParts(parts)
})
