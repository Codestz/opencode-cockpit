/**
 * Previews the loaded bays offer, by bay: the exact command for the copy installed here. Shared on
 * `globalThis` because the bundle and a standalone package each carry their own copy of this module.
 *
 * `bunx @opencode-cockpit/status preview` fetches the newest release from npm instead — 0.8 drew a
 * bottom line at terminal width for a 0.9 sidebar config — so the agent is handed the path.
 */

const PREVIEWS = Symbol.for("opencode-cockpit.previews")
const previewRegistry = (): Map<string, string> => {
  const shared = globalThis as { [PREVIEWS]?: Map<string, string> }
  shared[PREVIEWS] ??= new Map()
  return shared[PREVIEWS]
}

/** A bay's preview command, e.g. `bun "/…/status/dist/cli/preview.js"`. */
export function offerPreview(bay: string, command: string): void {
  previewRegistry().set(bay, command)
}

export const previewCommands = (): Record<string, string> => Object.fromEntries(previewRegistry())
