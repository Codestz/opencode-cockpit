/** Subagents: the product's recorded run, replayed up to any moment — the sidebar block and the pane. */
import type { Change } from "../../../packages/subagents/src/core/model/changes.ts"
import { applyAll, emptyModel, subagentsOf } from "../../../packages/subagents/src/core/model/model.ts"
import { SAMPLE_NOW, SAMPLE_ROOT, sample } from "../../../packages/subagents/src/core/sample.ts"
import { screenRows } from "../../../packages/subagents/src/core/view/screen.ts"
import { sidebarLines } from "../../../packages/subagents/src/core/view/sidebar.ts"

export { SAMPLE_NOW }
const CHANGES = sample()
/** The run's first minute: what `at` a second of replay maps to. */
export const START = SAMPLE_NOW - 60_000

/** The changes up to `now`. They are not in time order, and a part with no time takes the last seen. */
function upTo(now: number): Change[] {
  let last = 0
  return CHANGES.filter((c) => (last = (c as { at?: number }).at ?? last) <= now)
}
const nodesAt = (now: number) => subagentsOf(applyAll(emptyModel(), upTo(now)), SAMPLE_ROOT)

export const sidebar = (now: number, width: number, frame: number) =>
  sidebarLines({ nodes: nodesAt(now), width, now, frame, limit: 6 }).map((line) => line.row)

/** One subagent's pane (ctrl+x d), as it looked at `now`. */
export function pane(now: number, width: number, height: number, frame: number, which = 0) {
  const nodes = nodesAt(now)
  const node = nodes[Math.min(which, nodes.length - 1)]
  if (!node) return []
  return screenRows({
    session: node.session, nodes, launcher: "build", width, height, now, frame,
    open: new Set(), closed: new Set(), thinking: false, details: false,
  }).rows
}
