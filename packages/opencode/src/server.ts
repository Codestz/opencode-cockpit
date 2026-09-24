import { composeParts, dualServer } from "@opencode-cockpit/client/server"
import { createReviewServer } from "@opencode-cockpit/review/server"
import { createShellServer } from "@opencode-cockpit/shell/server"
import { BUNDLE, type CockpitOptions, featureOptions, isEnabled } from "./features.ts"

const shell = createShellServer({ source: BUNDLE })
const review = createReviewServer({ source: BUNDLE })

export default dualServer(BUNDLE, async (host, rawOptions) => {
  const options = rawOptions as CockpitOptions | undefined
  const parts = []
  if (isEnabled(options, "shell")) parts.push(await shell(host, featureOptions(options, "shell")))
  if (isEnabled(options, "review")) parts.push(await review(host, featureOptions(options, "review")))
  return composeParts(parts)
})
