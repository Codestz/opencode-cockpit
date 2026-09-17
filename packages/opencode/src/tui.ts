import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createShellTui } from "@opencode-cockpit/shell/tui"
import { BUNDLE, type CockpitOptions, featureOptions, isEnabled } from "./features.ts"

const shell = createShellTui({ source: BUNDLE })

const tui: TuiPlugin = async (api, rawOptions, meta) => {
  const options = rawOptions as CockpitOptions | undefined
  if (isEnabled(options, "shell")) await shell(api, featureOptions(options, "shell"), meta)
}

const plugin: TuiPluginModule & { id: string } = { id: BUNDLE, tui }
export default plugin
