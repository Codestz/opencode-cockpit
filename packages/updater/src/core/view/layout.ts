/**
 * The three screens as rows: the list, the review, the result. Every row is exactly `width` wide.
 *
 * The approved mock is the reference: https://claude.ai/artifact/H34qPDuKGKaEaG4SCunmbo
 */

import type { Change, PluginPlan } from "../plan.ts"
import { parseSpec } from "../spec.ts"
import type { Outcome } from "../verify.ts"
import { cell, cellLeft, type Fill, fit, type Row, type Run } from "./rows.ts"

/** The cursor's margin cell, then `[x] `: four for the box and its gap, one for the margin. */
const MARK = 5
const RUNNING = 10
const PUBLISHED = 12
/** Wide enough for `unreachable`, the longest thing the last column says. */
const STATE = 12

/** `~/.config/…` rather than `/Users/someone/.config/…`: the part that says something. */
export function tildePath(path: string, home: string | undefined): string {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** What the config column says: the tag or the pin, never the whole spec. */
export function configLabel(plan: PluginPlan): string {
  if (plan.state === "internal") return "built in"
  const labels = [
    ...new Set(
      plan.specs.map((raw) => {
        const spec = parseSpec(raw)
        if (spec.kind === "local") return raw
        if (spec.pin.type === "exact") return `@${spec.pin.version}`
        return spec.pin.type === "tag" ? spec.pin.tag : "latest"
      }),
    ),
  ]
  const [first = ""] = labels
  return labels.length > 1 ? `${first} +${labels.length - 1}` : first
}

export interface Selection {
  cursor: number
  selected: ReadonlySet<string>
}

/**
 * The list. With a `selection` it draws the mark column and the cursor, as the dialog does; without
 * one it is the CLI's table.
 */
export function listRows(
  all: readonly PluginPlan[],
  width: number,
  selection?: Selection,
  home?: string,
): Row[] {
  // OpenCode's own parts — its sidebar, its footer — are a dozen rows of nothing to do. One line says
  // they are there; listing them would bury the rows that need a decision.
  const plans = all.filter((plan) => plan.state !== "internal")
  const builtIn = all.length - plans.length
  const mark = selection ? MARK : 0

  /**
   * Columns sized to what they hold, as Review's counts column is (docs/building/terminal-ui.md):
   * the widest entry plus a gap, between a floor and a cap. Fixed widths cut a path to
   * `…ages/opencode` while a third of the dialog stood empty; now spare width stays at the end of the
   * row rather than opening gaps between columns, and the state column has a place of its own.
   */
  const configOf = (plan: PluginPlan): string => {
    const label = configLabel(plan)
    if (plan.state === "local") return tildePath(label, home)
    return plan.frozen && (plan.state === "update" || plan.state === "pin") ? `${label}  ⚠` : label
  }
  const widest = (texts: string[], floor: number, cap: number) =>
    Math.max(floor, Math.min(cap, Math.max(0, ...texts.map((t) => t.length)) + 2))
  const name = widest(["plugin", ...plans.map((p) => p.label ?? p.name)], 12, 36)
  const room = width - mark - name - RUNNING - PUBLISHED - STATE
  // Capped low on purpose: a spec is a word, and one long checkout path must not push every version
  // away from its spec. The path is the least important thing here, so it is what gets cut.
  const config = Math.max(10, Math.min(room, widest(["config", ...plans.map(configOf)], 10, 30)))
  const header: Row = {
    runs: fit(
      [
        { text: cell("", mark) },
        { text: cell("plugin", name), tone: "muted" },
        { text: cell("running", RUNNING), tone: "muted" },
        { text: cell("config", config), tone: "muted" },
        { text: cell("published", PUBLISHED), tone: "muted" },
      ],
      width,
    ),
  }
  const rows = plans.map((plan, i): Row => {
    const acting = plan.state === "update" || plan.state === "pin"
    const quiet = plan.state === "current" || plan.state === "unknown"
    const inert = plan.state === "internal" || plan.state === "local"
    const base = {
      tone: quiet || inert ? ("muted" as const) : ("text" as const),
      ...(inert ? { faint: true } : {}),
    }
    const fill: Fill = selection?.cursor === i ? "cursor" : "none"
    const on = (run: Run): Run => ({ ...base, ...run, ...(fill === "none" ? {} : { fill }) })

    const configText = configOf(plan)
    const state =
      plan.state === "update"
        ? { text: "↑", tone: "added" as const }
        : plan.state === "pin"
          ? { text: "pin", tone: "warning" as const }
          : plan.state === "unknown"
            ? { text: "unreachable" }
            : plan.state === "local"
              ? { text: "local" }
              : { text: "" }
    const runs: Run[] = [
      ...(selection
        ? [
            // The cursor is one coloured cell in the margin — the whole focus treatment, as in Review.
            on(selection.cursor === i ? { text: "▌", tone: "accent", faint: false } : { text: " " }),
            on({ text: cell(acting ? (selection.selected.has(plan.name) ? "[x]" : "[ ]") : "", mark - 1) }),
          ]
        : []),
      on({ text: cell(plan.label ?? plan.name, name) }),
      on({ text: cell(plan.running ?? "", RUNNING) }),
      on(
        acting && plan.frozen
          ? { text: cell(configText, config), tone: "warning" }
          : // A path is cut from the left: its end is the part that says which plugin it is.
            {
              text:
                plan.state === "local" ? `${cellLeft(configText, config - 2)}  ` : cell(configText, config),
            },
      ),
      on(
        plan.state === "unknown"
          ? { text: cell("?", PUBLISHED), tone: "warning" }
          : { text: cell(plan.published ?? "", PUBLISHED), ...(acting ? { tone: "added" as const } : {}) },
      ),
      on({ ...state, text: cell(state.text, STATE) }),
    ]
    return { runs: fit(runs, width, fill), target: plan.name }
  })
  const summary: Row[] =
    builtIn > 0
      ? [
          {
            runs: fit(
              [
                { text: cell("", mark) },
                { text: `${builtIn} built into OpenCode`, tone: "muted", faint: true },
              ],
              width,
            ),
          },
        ]
      : []
  return [header, ...rows, ...summary]
}

function band(plan: PluginPlan, width: number): Row {
  const runs: Run[] = [
    { text: cell(plan.name, Math.min(30, width)), bold: true, fill: "band" },
    ...(plan.running ? [{ text: plan.running, tone: "muted" as const, fill: "band" as const }] : []),
    { text: "  →  ", fill: "band" },
    { text: plan.published ?? "", tone: "added", fill: "band" },
  ]
  return { runs: fit(runs, width, "band"), target: plan.name }
}

interface Columns {
  path: number
  from: number
}

function changeRow(change: Change, width: number, home: string | undefined, columns: Columns): Row {
  const tag =
    change.file.owner === "manual"
      ? [{ text: "   edit by hand", tone: "warning" as const }]
      : change.file.scope === "project"
        ? [{ text: "   project", tone: "muted" as const }]
        : []
  return {
    runs: fit(
      [
        { text: "  " },
        { text: `${cellLeft(tildePath(change.file.path, home), columns.path - 2)}  `, tone: "muted" },
        { text: cell(change.from, columns.from), tone: "muted" },
        { text: "→   " },
        { text: change.to, tone: "added" },
        ...tag,
      ],
      width,
    ),
  }
}

/** What an update would do, before it does it. */
export function reviewRows(plans: readonly PluginPlan[], width: number, home?: string): Row[] {
  const rows: Row[] = []
  /**
   * Widths by importance, not by position. The new spec is the point of this screen and is never cut;
   * the old spec comes next; the path gives way first, cut from the left so the file name survives
   * (`…/opencode/tui.json`). A spec cut to `opencode-subagent-statusli…` hid the one value that
   * mattered, on a real config, at a real width.
   */
  const changes = plans.flatMap((plan) => plan.changes)
  const longest = (texts: string[]) => Math.max(0, ...texts.map((t) => t.length))
  const tagRoom = changes.some((c) => c.file.owner === "manual")
    ? 15
    : changes.some((c) => c.file.scope === "project")
      ? 10
      : 0
  const to = longest(changes.map((c) => c.to))
  let from = longest(changes.map((c) => c.from)) + 2
  let path = longest(changes.map((c) => tildePath(c.file.path, home))) + 2
  const over = () => 2 + path + from + 4 + to + tagRoom - width
  if (over() > 0) path = Math.max(14, path - over())
  if (over() > 0) from = Math.max(14, from - over())
  const columns: Columns = { path, from }
  plans.forEach((plan, i) => {
    if (i > 0) rows.push({ runs: fit([], width) })
    rows.push(band(plan, width))
    for (const change of plan.changes) rows.push(changeRow(change, width, home, columns))
    for (const dir of plan.remove) {
      rows.push({
        runs: fit(
          [
            { text: "  " },
            { text: "remove", tone: "removed" },
            { text: "  " },
            { text: cellLeft(tildePath(dir, home), width - 10), tone: "muted" },
          ],
          width,
        ),
      })
    }
  })
  return rows
}

/**
 * What disk said afterwards, and for anything wrong, the command that fixes it.
 *
 * One problem that fits goes on the plugin's own line, as in the mock; otherwise every problem gets
 * a line of its own underneath. Fix lines can be cut at the edge here — the dialog copies them whole,
 * and the CLI prints them again uncut, because a command is only useful if it can be pasted.
 */
export function resultRows(plans: readonly PluginPlan[], outcomes: readonly Outcome[], width: number): Row[] {
  const rows: Row[] = []
  const inline = 30 + 20 + 3
  const indent = "     "
  outcomes.forEach((outcome, i) => {
    const plan = plans.find((p) => p.name === outcome.name)
    const running = plan?.running ?? ""
    const published = plan?.published ?? ""
    const gap = " ".repeat(Math.max(1, 20 - running.length - 3 - published.length))
    const [only] = outcome.problems
    const oneLine = outcome.problems.length === 1 && only !== undefined && inline + only.length <= width
    const summary = outcome.ok
      ? { text: outcome.confirmed.join(" · "), tone: "muted" as const }
      : oneLine
        ? { text: only }
        : { text: `${outcome.problems.length} problem${outcome.problems.length === 1 ? "" : "s"}` }
    if (i > 0) rows.push({ runs: fit([], width) })
    rows.push({
      runs: fit(
        [
          { text: cell(outcome.name, 30) },
          { text: running, tone: "muted" },
          { text: " → " },
          { text: published + gap, tone: "added" },
          outcome.ok ? { text: "✓  ", tone: "added" } : { text: "!  ", tone: "removed" },
          summary,
        ],
        width,
      ),
      target: outcome.name,
    })
    for (const problem of oneLine ? [] : outcome.problems) {
      rows.push({ runs: fit([{ text: indent }, { text: problem }], width) })
    }
    for (const fix of outcome.fixes) {
      rows.push({ runs: fit([{ text: indent }, { text: "fix  ", tone: "muted" }, { text: fix }], width) })
    }
  })
  return rows
}

/** A screen's first line: what it is on the left, a quiet note on the right. */
export function titleRow(title: string, note: string, width: number): Row {
  const gap = Math.max(1, width - title.length - note.length)
  return {
    runs: fit([{ text: title, bold: true }, { text: " ".repeat(gap) }, { text: note, tone: "muted" }], width),
  }
}

/**
 * The footer's keys in the shape Shell and Review use: `[key]` in the accent, the label muted, three
 * spaces between. A bracketed key is recognised rather than read. Hints drop from the right when the
 * row is too narrow, never cut in half.
 */
export function keyRow(keys: readonly (readonly [string, string])[], width: number): Row {
  const runs: Run[] = []
  let used = 0
  for (const [key, label] of keys) {
    const size = (runs.length > 0 ? 3 : 0) + key.length + 2 + 1 + label.length
    if (used + size > width) break
    if (runs.length > 0) runs.push({ text: "   " })
    runs.push({ text: `[${key}]`, tone: "accent", bold: true }, { text: ` ${label}`, tone: "muted" })
    used += size
  }
  return { runs: fit(runs, width) }
}
