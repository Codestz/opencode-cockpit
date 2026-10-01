import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import {
  CLOSE_KEY,
  GLYPH,
  type Hint,
  keyName,
  labelCase,
  duration as ran,
  STATE_WORD,
  type State,
  type StateTone,
  stateMark,
  toneOf,
} from "@opencode-cockpit/client/design"
import type { ScreenRun, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { duration } from "../../core/format.ts"

export { SPINNER } from "@opencode-cockpit/client/design"

/** What a human cares about, derived from status + exit code so every surface agrees. */
export type Kind = "run" | "fail" | "stop" | "done"

export function kindOf(s: ShellInfo): Kind {
  if (s.status === "running") return "run"
  if (s.status === "killed") return "stop"
  if (s.status === "exited" && s.exitCode === 0) return "done"
  return "fail"
}

export const BADGE_LABEL: Record<Kind, string> = { run: "RUN", fail: "FAIL", stop: "STOP", done: "DONE" }

/** A shell's kind in the words every bay shares, so it wears the tone and mark every bay does. */
export const STATE: Record<Kind, State> = { run: "running", fail: "failed", stop: "stopped", done: "done" }

/** The tone a kind wears: running is the accent, as a running subagent's is — green means it worked. */
export const kindTone = (kind: Kind): StateTone => toneOf(STATE[kind])

/** The one place a tone becomes a colour for the components that draw straight from the theme. */
export function toneColor(theme: TuiThemeCurrent, tone: StateTone | "success" | "text" | "border") {
  switch (tone) {
    case "accent":
      return theme.accent
    case "warning":
      return theme.warning
    case "success":
      return theme.success
    case "error":
      return theme.error
    case "border":
      return theme.border
    case "text":
      return theme.text
    default:
      return theme.textMuted
  }
}

export const kindColor = (theme: TuiThemeCurrent, kind: Kind) => toneColor(theme, kindTone(kind))

/**
 * The status mark: the state's mark and its word, in a fixed 6 columns so lists line up.
 *
 * It used to be a filled pill, then a coloured `▌` rule. A pill stacked into a wall of colour; the
 * rule borrowed the glyph every other surface uses for the cursor, so a list of shells looked like a
 * list of selections. The mark is the one a subagent wears — a spinner while it runs, a dot once it
 * ends — and the word says what the colour says, for anyone who cannot tell the colours apart.
 */
export function badgeText(kind: Kind, frame = 0): string {
  return `${stateMark(STATE[kind], frame).text} ${BADGE_LABEL[kind].padEnd(4)}`
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
      return `${stopWord(s)} after ${ran} · ${ago}`
    case "fail":
      if (s.status === "failed") return "could not start"
      return `exit ${s.exitCode ?? "?"} after ${ran} · ${ago}`
  }
}

/** Why it stopped, in one word, because the panel has room for exactly that. */
function stopWord(s: ShellInfo): string {
  switch (s.stopReason) {
    case "timeout":
      return "timed out"
    case "idle":
      return "idle-stopped"
    case "shutdown":
      return "daemon stopped it"
    case "request":
      return s.stoppedBy?.includes("tui") ? "you stopped it" : "agent stopped it"
    default:
      return "stopped"
  }
}

/**
 * Short health label for a watched shell, e.g. "watch tsc ✗" — empty only when nothing watches it.
 *
 * Shown while the watch is still pending too. It used to appear only once the first run finished,
 * so a watched shell looked exactly like a plain one until then — and "is this one being watched"
 * is the question you have before that, not after.
 */
export function watchLabel(s: ShellInfo): string {
  const watch = s.watch
  if (!watch) return ""
  const name = watch.preset && watch.preset !== "watch" ? `watch ${watch.preset}` : "watch"
  if (watch.status === "pending") return `${name} ${GLYPH.more}`
  /** A watch is a check, so it says so with the check marks, not the state marks. */
  const mark = watch.status === "ok" ? GLYPH.check : watch.status === "fail" ? GLYPH.cross : "?"
  return `${name} ${mark}`
}

export function watchColor(theme: TuiThemeCurrent, s: ShellInfo) {
  switch (s.watch?.status) {
    case "ok":
      return theme.success
    case "fail":
      return theme.error
    /** Pending: still unmistakably a watcher, in the colour the console uses for what is live. */
    case "pending":
      return theme.accent
    default:
      return theme.textMuted
  }
}

/**
 * Compact detail for narrow lists: how long it ran, in the sidebar's one kind of time — or, for a
 * failure, the exit code, which is the fact worth the room.
 *
 * A finished shell said `4m ago` here, beside a subagent's `28m08s`: "since" in one block and "for"
 * in the next, in one column. The badge already says it stopped or finished.
 */
export function shortDetail(s: ShellInfo, now: number): string {
  switch (kindOf(s)) {
    case "fail":
      return s.status === "failed" ? "no start" : `exit ${s.exitCode ?? "?"}`
    case "run":
      return ran(now - s.startedAt)
    default:
      return s.endedAt !== undefined ? ran(s.endedAt - s.startedAt) : STATE_WORD[STATE[kindOf(s)]]
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

/**
 * Last `rows` styled rows, each cut to `cols`, so colour survives the same trimming as text.
 * `up` moves the window that many rows back from the bottom, for scrolling through history.
 */
export function tailRuns(
  styled: ScreenRun[][] | undefined,
  rows: number,
  cols: number,
  up = 0,
): ScreenRun[][] {
  if (!styled) return []
  const end = Math.max(0, styled.length - Math.max(0, up))
  return styled.slice(Math.max(0, end - rows), end).map((row) => {
    const out: ScreenRun[] = []
    let width = 0
    for (const run of row) {
      if (width >= cols) break
      const text = run.text.slice(0, cols - width)
      width += text.length
      out.push({ ...run, text })
    }
    return out
  })
}

/** Last `rows` lines of screen text, each cut to `cols`; `up` as for `tailRuns`. */
export function tailLines(text: string | undefined, rows: number, cols: number, up = 0): string {
  if (!text) return ""
  const lines = text.split("\n")
  const end = Math.max(0, lines.length - Math.max(0, up))
  return lines
    .slice(Math.max(0, end - rows), end)
    .map((l) => (l.length > cols ? `${l.slice(0, Math.max(0, cols - 1))}…` : l))
    .join("\n")
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

/**
 * One key and what it does, in the `[key] Label` shape every bay writes (`@opencode-cockpit/client/design`).
 *
 * The console used to say `i type · c ^C · r restart · tab screen · / search log`, which is a
 * sentence you have to parse before you can use it — the reader has to work out where each key stops
 * and its description starts. A bracketed key is a *shape*, recognised rather than read, and it does
 * that work without spending colour, which the console needs for the shells themselves.
 */
export interface KeyHint extends Hint {
  /**
   * `act` does something to the shell in front of you and earns a place on the row whatever the
   * width. `more` moves, switches or manages, and lives in the details panel, which has room to lay
   * it out properly instead of competing for a single line.
   */
  tier: "act" | "more"
}

export interface ConsoleKeysState {
  /** False when no shell is selected, which leaves almost nothing worth offering. */
  shell: boolean
  running: boolean
  view: "log" | "screen" | "details"
  /** A filter is on, so there is something to clear. */
  filtered: boolean
  /** How many shells the console can move between. */
  count: number
  scope: "session" | "project"
  /** Finished shells, which are the only ones `D` would clear. */
  finished: number
  /** Over the whole window rather than in the dialog. */
  full?: boolean
}

/** The way out, on every row whatever else is there: "how do I leave" is never one press away. */
const CLOSE: KeyHint = { key: CLOSE_KEY, label: "Close", tier: "act", close: true }

/** Only the keys that do something right now: no actions without a target, no concepts from elsewhere. */
export function consoleKeys(state: ConsoleKeysState): KeyHint[] {
  if (!state.shell) {
    /** An empty session is not an empty project: the shells may all be one key away. */
    return [
      { key: "n", label: "New", tier: "act" },
      ...(state.scope === "session" ? [{ key: "s", label: "Whole Project", tier: "act" as const }] : []),
      CLOSE,
    ]
  }
  /** In the order drawn; a narrow row keeps typing and stopping, and gives up `^C` and restart first. */
  const keys: KeyHint[] = state.running
    ? [
        { key: "i", label: "Type", tier: "act", priority: 9 },
        { key: "c", label: "^C", tier: "act", priority: 6 },
        { key: "r", label: "Restart", tier: "act", priority: 5 },
        { key: "x", label: "Stop", tier: "act", priority: 8 },
      ]
    : [
        { key: "r", label: "Run Again", tier: "act" },
        { key: "d", label: "Remove", tier: "act" },
      ]
  if (state.view === "log" && state.filtered) keys.push({ key: "⌫", label: "Clear Filter", tier: "more" })
  keys.push({ key: "tab", label: state.view === "log" ? "Screen" : "Log", tier: "more" })
  if (state.view !== "details") keys.push({ key: "/", label: "Search Log", tier: "more" })
  /** Named for the arrows, which are bound beside `[` and `]`: a key called `[ ]` read as a checkbox. */
  if (state.count > 1) keys.push({ key: "←/→", label: "Switch Shell", tier: "more" })
  keys.push({
    key: "s",
    label: state.scope === "session" ? "Whole Project" : "This Session",
    tier: "more",
  })
  if (state.finished > 0) keys.push({ key: "D", label: "Clear Done", tier: "more" })
  keys.push({ key: "w", label: state.full ? "Dialog" : "Full Screen", tier: "more" })
  keys.push({ key: "n", label: "New Shell", tier: "more" }, CLOSE)
  return keys
}

/**
 * The row under the console: what acts on this shell, the way to everything else, and the way out.
 *
 * A footer carrying every key is a wall — nine bracketed keys with no room for their words, which is
 * what it became. These are the ones whose absence would cost a press right now; the rest are a
 * keystroke away and laid out in columns where they can be read.
 */
export function footerHints(state: ConsoleKeysState): KeyHint[] {
  const all = consoleKeys(state)
  const acting = all.filter((hint) => hint.tier === "act" && !hint.close)
  if (all.every((hint) => hint.tier === "act")) return all
  /** The way to every other key outranks any one of them: a narrow row keeps it and drops `r`. */
  const more: KeyHint = {
    key: "?",
    label: state.view === "details" ? "Back" : "Details",
    tier: "act",
    priority: 10,
  }
  return [...acting, more, CLOSE]
}

/** Everything the footer left out, for the panel that has room for it. */
export function panelHints(state: ConsoleKeysState): KeyHint[] {
  return consoleKeys(state).filter((hint) => hint.tier === "more")
}

/**
 * The other keys, two to a line.
 *
 * `detailRows` is already a label column and a value column, so the keys join it as rows rather than
 * as a panel of their own — one place to look, one alignment, and the section cannot drift out of
 * step with what the footer offers because both are built from `consoleKeys`.
 */
export function keyRows(hints: readonly KeyHint[], cols: number): [string, string][] {
  if (hints.length === 0) return []
  const cell = (hint: KeyHint) => `${keyName(hint.key).padEnd(5)}${labelCase(hint.label)}`
  const cells = hints.map(cell)
  /** The second column starts just past the longest first one — not at half the panel. */
  const gutter = Math.min(
    Math.max(16, Math.floor(Math.max(20, cols - 11) / 2)),
    Math.max(...cells.filter((_, index) => index % 2 === 0).map((text) => text.length)) + 4,
  )
  const rows: [string, string][] = []
  for (let index = 0; index < cells.length; index += 2) {
    const left = cells[index] as string
    const right = cells[index + 1]
    rows.push([index === 0 ? "keys" : "", right ? `${left.padEnd(gutter)}${right}` : left])
  }
  return rows
}

/** What one row of the `/shells` list says, as data — the dialog only paints it. */
export interface ShellListItem {
  title: string
  /** The command when the title does not already say it, then where it runs and its watch. */
  description: string
  /** Grouped the way the panel ranks them: what is running first, then what needs a look. */
  category: "Running" | "Watching" | "Failed" | "Finished"
  kind: Kind
  /** `RUN 3m`, `DONE took 2s · 4m ago` — the badge, then the facts. */
  status: string
}

export function shellListItem(s: ShellInfo, now: number, project: string): ShellListItem {
  const kind = kindOf(s)
  const command = displayCommand(s)
  const where = relativeCwd(s.cwd, project)
  const watch = watchLabel(s)
  const said = s.title.trim() === command.trim() ? "" : `$ ${command}`
  return {
    title: s.title,
    description: [said, where ? `in ${where}` : "", watch].filter(Boolean).join(" · "),
    /** A watcher is a different kind of running: it is there to tell you when something breaks. */
    category: kind === "run" ? (s.watch ? "Watching" : "Running") : kind === "fail" ? "Failed" : "Finished",
    kind,
    status: `${BADGE_LABEL[kind]} ${statusDetail(s, now)}`,
  }
}
