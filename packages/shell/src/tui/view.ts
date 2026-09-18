import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { duration } from "../tools/format.ts"

/** What a human cares about, derived from status + exit code so every surface agrees. */
export type Kind = "run" | "fail" | "stop" | "done"

export function kindOf(s: ShellInfo): Kind {
  if (s.status === "running") return "run"
  if (s.status === "killed") return "stop"
  if (s.status === "exited" && s.exitCode === 0) return "done"
  return "fail"
}

export const BADGE_LABEL: Record<Kind, string> = { run: "RUN", fail: "FAIL", stop: "STOP", done: "DONE" }

/** Braille spinner: single-width in every terminal font. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function kindColor(theme: TuiThemeCurrent, kind: Kind) {
  switch (kind) {
    case "run":
      return theme.success
    case "fail":
      return theme.error
    case "stop":
      return theme.warning
    case "done":
      return theme.textMuted
  }
}

/** Fixed 7-column pill so lists line up: " ⠹ RUN ", " FAIL  ". */
export function badgeText(kind: Kind, frame = 0): string {
  if (kind === "run") return ` ${SPINNER[frame % SPINNER.length]} RUN `
  return ` ${BADGE_LABEL[kind].padEnd(4)}  `
}

const RANK: Record<Kind, number> = { run: 0, fail: 1, stop: 2, done: 3 }

/** Running first (oldest first, stable tabs), then failures, stopped, done (most recent first). */
export function order(list: readonly ShellInfo[]): ShellInfo[] {
  return [...list].sort((a, b) => {
    const ka = kindOf(a)
    const kb = kindOf(b)
    if (ka !== kb) return RANK[ka] - RANK[kb]
    if (ka === "run") return a.startedAt - b.startedAt
    return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)
  })
}

export interface PartitionOptions {
  showAll: boolean
  /** Failures stay visible this long after they end. */
  historyMs: number
  now: number
  /** Always visible, so the selection never disappears under the user. */
  keep?: string
}

/** Default view: running shells and recent failures. Everything else folds into a "N more" chip. */
export function partition(list: readonly ShellInfo[], opts: PartitionOptions) {
  const ordered = order(list)
  if (opts.showAll) return { visible: ordered, hidden: [] as ShellInfo[] }
  const visible: ShellInfo[] = []
  const hidden: ShellInfo[] = []
  for (const s of ordered) {
    const kind = kindOf(s)
    const recent = opts.now - (s.endedAt ?? opts.now) <= opts.historyMs
    if (kind === "run" || (kind === "fail" && recent) || s.id === opts.keep) visible.push(s)
    else hidden.push(s)
  }
  return { visible, hidden }
}

export function statusDetail(s: ShellInfo, now: number): string {
  const kind = kindOf(s)
  const ran = duration((s.endedAt ?? now) - s.startedAt)
  const ago = s.endedAt ? since(now - s.endedAt) : ""
  switch (kind) {
    case "run":
      return ran
    case "done":
      return `took ${ran} · ${ago}`
    case "stop":
      return `stopped after ${ran} · ${ago}`
    case "fail":
      if (s.status === "failed") return "could not start"
      return `exit ${s.exitCode ?? "?"} after ${ran} · ${ago}`
  }
}

/** Short health label for a watched shell, e.g. "tsc ✗" — empty when nothing is watching it. */
export function watchLabel(s: ShellInfo): string {
  const watch = s.watch
  if (!watch || watch.status === "pending") return ""
  const mark = watch.status === "ok" ? "✓" : watch.status === "fail" ? "✗" : "?"
  return `${watch.preset ?? "watch"} ${mark}`
}

export function watchColor(theme: TuiThemeCurrent, s: ShellInfo) {
  switch (s.watch?.status) {
    case "ok":
      return theme.success
    case "fail":
      return theme.error
    default:
      return theme.textMuted
  }
}

/** Compact detail for narrow lists. */
export function shortDetail(s: ShellInfo, now: number): string {
  switch (kindOf(s)) {
    case "run":
      return duration(now - s.startedAt)
    case "fail":
      return s.status === "failed" ? "no start" : `exit ${s.exitCode ?? "?"}`
    case "stop":
      return "stopped"
    case "done":
      return s.endedAt ? since(now - s.endedAt) : "done"
  }
}

/** Coarse relative time: "just now", "12s ago", "9m ago", "3h ago". */
export function since(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** The command as the user or agent wrote it, without the `$SHELL -c` wrapper. */
export function displayCommand(s: ShellInfo): string {
  if (s.args.length === 2 && s.args[0] === "-c" && /(^|\/)(ba|z|fi|da|k)?sh$/.test(s.command))
    return s.args[1] as string
  return [s.command, ...s.args].join(" ")
}

/** Folder relative to the project: "" at the root, "./sub" inside, "~/x" elsewhere under home. */
export function relativeCwd(cwd: string, project: string, home = process.env.HOME ?? ""): string {
  const trim = (p: string) => p.replace(/\/+$/, "")
  const c = trim(cwd)
  const p = trim(project)
  if (c === p) return ""
  if (c.startsWith(`${p}/`)) return `./${c.slice(p.length + 1)}`
  if (home && c.startsWith(`${trim(home)}/`)) return `~/${c.slice(trim(home).length + 1)}`
  return c
}

/** Hard-wraps to `width`, at most `maxLines`; the last line ends with … when text was cut. */
export function wrapText(text: string, width: number, maxLines: number): string[] {
  const flat = text.replace(/\s*\n\s*/g, " ⏎ ")
  const w = Math.max(4, width)
  const lines: string[] = []
  for (let i = 0; i < flat.length && lines.length < maxLines; i += w) lines.push(flat.slice(i, i + w))
  if (lines.length === 0) return [""]
  if (flat.length > w * maxLines) {
    const last = lines[lines.length - 1] as string
    lines[lines.length - 1] = `${last.slice(0, w - 1)}…`
  }
  return lines
}

/** Last `rows` lines of screen text, each cut to `cols`. */
export function tailLines(text: string | undefined, rows: number, cols: number): string {
  if (!text) return ""
  const lines = text.split("\n")
  return lines
    .slice(Math.max(0, lines.length - rows))
    .map((l) => (l.length > cols ? `${l.slice(0, Math.max(0, cols - 1))}…` : l))
    .join("\n")
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}
