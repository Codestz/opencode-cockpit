/** Trail: its own sample trails, its own trail_add, its own sidebar block and /trail dialog. */
import { arrange, conversationThings } from "../../../packages/trail/src/core/model.ts"
import { SAMPLE_NOW, SAMPLE_SESSION, SAMPLES } from "../../../packages/trail/src/core/sample.ts"
import { emptyState, type State } from "../../../packages/trail/src/core/store.ts"
import { runAdd } from "../../../packages/trail/src/core/tools.ts"
import { type DialogInput, dialogRows } from "../../../packages/trail/src/core/view/dialog.ts"
import { sidebarRows } from "../../../packages/trail/src/core/view/sidebar.ts"

export { emptyState, SAMPLE_NOW, SAMPLE_SESSION }
export type { State }

let counter = 0
/** The agent's trail_add call, as the tool runs it. */
export function add(state: State, args: Record<string, string>, at: number, session = SAMPLE_SESSION) {
  return runAdd(state, args, {
    session,
    rootSession: session,
    sessionTitle: "Fix the bundle desync",
    by: "agent",
    at,
    id: `ev_site_${++counter}`,
  } as never)
}

export const sidebar = (state: State, session: string, width: number, now: number, limit = 6) =>
  sidebarRows({ width, arranged: arrange(conversationThings(state, session)), now, limit }).rows

/** A finished trail from the product's samples ("busy": nine records, two conversations). */
export function sample(name = "busy") {
  const { state, session } = (SAMPLES[name] as () => { state: State; session: string })()
  return {
    sidebar: (width: number, limit = 6) => sidebar(state, session, width, SAMPLE_NOW, limit),
    dialog: (input: Partial<DialogInput> & { width: number; height: number }) =>
      dialogRows({ state, session, now: SAMPLE_NOW, project: "opencode-cockpit", tab: "this", ...input }),
  }
}
