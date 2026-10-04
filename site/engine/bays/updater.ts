/** Updater: /plugins-update over four plugins — two behind, one unreachable, one local. */
import { buildPlan } from "../../../packages/updater/src/core/plan.ts"
import { parseSpec } from "../../../packages/updater/src/core/spec.ts"
import { keyRow, listRows, titleRow } from "../../../packages/updater/src/core/view/layout.ts"

const FILE = { path: "/home/me/.config/opencode/opencode.json", scope: "global", owner: "config" }

export function list(width: number, cursor: number, selected: readonly string[], latest: string) {
  const plans = buildPlan({
    plugins: [
      { name: "opencode-cockpit", source: "npm", running: "0.8.0" },
      { name: "@acme/opencode-lint-rules", source: "npm", running: "1.2.0" },
      { name: "oc-offline", source: "npm", running: "2.0.0" },
      { name: "/home/me/work/plugins/shell-experiments", source: "file" },
    ],
    entries: [
      { file: FILE, spec: parseSpec("opencode-cockpit") },
      { file: FILE, spec: parseSpec("@acme/opencode-lint-rules@latest") },
      { file: FILE, spec: parseSpec("oc-offline") },
    ],
    published: new Map([["opencode-cockpit", latest], ["@acme/opencode-lint-rules", "1.3.0"]]),
    cacheDirs: new Map(),
  } as never)
  const gap = { runs: [{ text: " ".repeat(width) }] }
  return [
    titleRow("Plugins", "what runs · what is published", width),
    gap,
    ...listRows(plans, width, { cursor, selected: new Set(selected) } as never, "/home/me"),
    gap,
    keyRow([["space", "Select"], ["enter", "Update"], ["esc", "Close"]] as never, width),
  ]
}
