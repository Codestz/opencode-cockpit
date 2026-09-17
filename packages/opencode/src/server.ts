import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { createShellServer } from "@opencode-cockpit/shell/server"
import { composeHooks } from "./compose.ts"
import { BUNDLE, type CockpitOptions, featureOptions, isEnabled } from "./features.ts"

const shell = createShellServer({ source: BUNDLE })

const server: Plugin = async (input, rawOptions) => {
  const options = rawOptions as CockpitOptions | undefined
  const parts: Hooks[] = []
  if (isEnabled(options, "shell")) parts.push(await shell(input, featureOptions(options, "shell")))
  return composeHooks(parts)
}

const plugin: PluginModule & { id: string } = { id: BUNDLE, server }
export default plugin
