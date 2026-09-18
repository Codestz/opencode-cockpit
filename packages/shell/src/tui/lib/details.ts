import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { kindOfShell } from "../../core/kind.ts"
import { displayCommand, statusDetail, truncate, wrapText } from "./view.ts"

/** Everything known about one shell, for the console's details view. */
export function detailRows(s: ShellInfo, now: number, cols: number): [string, string][] {
  const width = Math.max(10, cols - 11)
  const rows: [string, string][] = []
  for (const [i, line] of wrapText(displayCommand(s), width, 12).entries())
    rows.push([i === 0 ? "command" : "", line])
  rows.push(["kind", kindOfShell(s)])
  rows.push(["folder", s.cwd])
  rows.push([
    "status",
    `${s.status}${s.exitCode !== undefined ? ` (exit ${s.exitCode})` : ""}${s.signal ? ` (${s.signal})` : ""}`,
  ])
  rows.push(["timing", statusDetail(s, now)])
  rows.push(["started", new Date(s.startedAt).toLocaleString()])
  if (s.summary) rows.push(["summary", truncate(s.summary, width)])
  rows.push(["id", `${s.id} · run ${s.run}${s.pid ? ` · pid ${s.pid}` : ""}`])
  rows.push(["owner", s.owner.session ? `agent session ${s.owner.session}` : "you"])
  if (s.watch) {
    rows.push([
      "watch",
      `${s.watch.preset ?? "custom rule"} · ${s.watch.status} · ${s.watch.runs} run${s.watch.runs === 1 ? "" : "s"}${s.watch.summary ? ` · ${truncate(s.watch.summary, width - 30)}` : ""}`,
    ])
  }
  rows.push(["output", `${s.lines.last} lines · ${Math.round(s.bytes / 1024)} KiB`])
  if (s.logFile) rows.push(["log file", s.logFile])
  return rows
}
