/** Trust: its engine run over a sample session — the /trust screen and the sidebar block. */
import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../../../packages/trust/src/core/sample.ts"
import { activityRows } from "../../../packages/trust/src/core/view/activity.ts"
import { sidebarRows } from "../../../packages/trust/src/core/view/sidebar.ts"

const sample = (name: string) => SAMPLES[name]()

export function sidebar(name: string, width: number) {
  const { engine, trouble } = sample(name)
  return sidebarRows({ width, recent: engine.recent(), count: engine.count(), pending: engine.pending(), state: engine.state, limit: 3, ...(trouble ? { trouble } : {}) } as never)
}

/** ctrl+x p: what it answered today, what is almost earned, the rules. */
export function activity(name: string, width: number, height: number) {
  const { engine } = sample(name)
  return activityRows({ state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW, history: engine.history, width, height, project: "app" } as never).rows
}
