/** Status: the sidebar table and the line under the prompt, over the product's fixtures. */
import { FIXTURES } from "../../../packages/status/src/core/fixtures.ts"
import { fit, fitColumn } from "../../../packages/status/src/core/render.ts"
import { buildSegments } from "../../../packages/status/src/core/segments.ts"
import type { Run } from "../paint.ts"

/* SIDEBAR_SEGMENTS (status/src/core/config.ts), copied: config.ts reaches for the settings file. */
const SIDEBAR = ["title", { type: "context", style: "solid", width: 16, icon: "" }, { type: "session.status", priority: 95, icon: "", working: false }, "diagnostics", { type: "tokens", style: "row", icon: "" }, "in", "out", "cache", "write", "sep", "spend", "avail", "sep", "git"].map((e) => (typeof e === "string" ? { type: e } : e))
const LINE = [{ type: "context", style: "bar", width: 14, icon: "" }, { type: "tokens", format: "tk {total}", icon: "" }, { type: "git.diff", icon: "" }, "todo", "session.status"].map((e) => (typeof e === "string" ? { type: e } : e))

type Fixture = keyof typeof FIXTURES
const ctx = (fixture: Fixture, width: number) => ({ ...FIXTURES[fixture].ctx, width })

export const table = (fixture: Fixture, width: number, rows = 14) =>
  fitColumn(buildSegments(ctx(fixture, width), SIDEBAR as never, { icons: true, debug: false }), width, rows).segments.map((s) => s.runs as Run[])

export function line(fixture: Fixture, width: number): Run[][] {
  const out: Run[] = []
  fit(buildSegments(ctx(fixture, width), LINE as never, { icons: true, debug: false }), width, " │ ").segments.forEach((s, i) => {
    if (i) out.push({ text: " │ ", tone: "border" })
    out.push(...(s.runs as Run[]))
  })
  return [out]
}
