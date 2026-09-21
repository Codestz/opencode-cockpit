import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createReviewTui } from "@opencode-cockpit/review/tui"
import { createShellTui } from "@opencode-cockpit/shell/tui"
import { createStatusTui } from "@opencode-cockpit/status/tui"
import { BUNDLE, type CockpitOptions, featureOptions, isEnabled } from "./features.ts"

const shell = createShellTui({ source: BUNDLE })
const status = createStatusTui({ source: BUNDLE })
const review = createReviewTui({ source: BUNDLE })

const tui: TuiPlugin = async (api, rawOptions, meta) => {
  const options = rawOptions as CockpitOptions | undefined
  if (isEnabled(options, "shell")) await shell(api, featureOptions(options, "shell"), meta)
  if (isEnabled(options, "status")) await status(api, featureOptions(options, "status"), meta)
  if (isEnabled(options, "review")) await review(api, featureOptions(options, "review"), meta)
}

const plugin: TuiPluginModule & { id: string } = { id: BUNDLE, tui }
export default plugin
