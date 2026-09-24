import { dualTui } from "@opencode-cockpit/client/host"
import { createReviewTui } from "@opencode-cockpit/review/tui"
import { createShellTui } from "@opencode-cockpit/shell/tui"
import { createStatusTui } from "@opencode-cockpit/status/tui"
import { createUpdaterTui } from "@opencode-cockpit/updater/tui"
import { BUNDLE, type CockpitOptions, featureOptions, isEnabled } from "./features.ts"

const shell = createShellTui({ source: BUNDLE })
const status = createStatusTui({ source: BUNDLE })
const review = createReviewTui({ source: BUNDLE })
const updater = createUpdaterTui({ source: BUNDLE })

/** One entry for both OpenCodes (docs/opencode/v2.md): each bay starts on the same Host. */
export default dualTui(BUNDLE, async (host, rawOptions) => {
  const options = rawOptions as CockpitOptions | undefined
  if (isEnabled(options, "shell")) await shell(host, featureOptions(options, "shell"))
  if (isEnabled(options, "status")) await status(host, featureOptions(options, "status"))
  if (isEnabled(options, "review")) await review(host, featureOptions(options, "review"))
  if (isEnabled(options, "updater")) await updater(host, featureOptions(options, "updater"))
})
