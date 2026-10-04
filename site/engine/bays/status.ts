/**
 * Status: the sidebar table and the line under the prompt, drawn from a live context. `at(p)` is one
 * session `p` of the way through a long turn: the window filling from a seventh to nearly full, the
 * tokens it went on, the diff growing, the spend — so the bar crosses the gauge's two steps (0.75,
 * 0.9) the way it does in a real session, not in jumps between fixtures.
 */
import { FIXTURES } from "../../../packages/status/src/core/fixtures.ts"
import { fit, fitColumn } from "../../../packages/status/src/core/render.ts"
import { buildSegments } from "../../../packages/status/src/core/segments.ts"
import type { Run } from "../paint.ts"

/* SIDEBAR_SEGMENTS (status/src/core/config.ts), copied: config.ts reaches for the settings file. */
const SIDEBAR = ["title", { type: "context", style: "solid", width: 16, icon: "" }, { type: "session.status", priority: 95, icon: "", working: false }, "diagnostics", { type: "tokens", style: "row", icon: "" }, "in", "out", "cache", "write", "sep", "spend", "avail", "sep", "git"].map((e) => (typeof e === "string" ? { type: e } : e))
const LINE = [{ type: "context", style: "bar", width: 14, icon: "" }, { type: "tokens", format: "tk {total}", icon: "" }, { type: "git.diff", icon: "" }, "todo", "session.status"].map((e) => (typeof e === "string" ? { type: e } : e))

const base = FIXTURES.busy.ctx
const lerp = (a: number, b: number, p: number) => Math.round(a + (b - a) * p)

/** The session `p` (0..1) of the way through. */
function at(p: number, width: number) {
  const s = base.session
  const cache = lerp(24_000, 178_000, p)
  return {
    ...base,
    // the turn's clock runs with the session: a minute and a half more by the end
    now: base.now + Math.round(p * 90_000),
    width,
    session: {
      ...s,
      status: "busy",
      cost: Math.round((0.18 + 3.1 * p) * 100) / 100,
      messages: lerp(6, 64, p),
      tokens: { input: lerp(900, 6_400, p), output: lerp(300, 3_900, p), reasoning: 0, cache: { read: cache, write: lerp(1_200, 4_100, p) } },
      diff: { files: lerp(1, 9, p), additions: lerp(12, 286, p), deletions: lerp(2, 61, p) },
      todo: { total: 6, completed: Math.min(6, Math.floor(p * 7)) },
    },
  }
}

export const table = (p: number, width: number, rows = 14) =>
  fitColumn(buildSegments(at(p, width) as never, SIDEBAR as never, { icons: true, debug: false }), width, rows).segments.map((s) => s.runs as Run[])

export function line(p: number, width: number): Run[][] {
  const out: Run[] = []
  fit(buildSegments(at(p, width) as never, LINE as never, { icons: true, debug: false }), width, " │ ").segments.forEach((s, i) => {
    if (i) out.push({ text: " │ ", tone: "border" })
    out.push(...(s.runs as Run[]))
  })
  return [out]
}
