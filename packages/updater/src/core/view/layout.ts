/**
 * The three screens as rows: the list, the review, the result. Every row is exactly `width` wide.
 *
 * The approved mock is the reference: https://claude.ai/artifact/H34qPDuKGKaEaG4SCunmbo
 */

import { checkbox, fitHints, GLYPH, type Hint } from "@opencode-cockpit/client/design"
import type { Change, PluginPlan } from "../plan.ts"
import { parseSpec } from "../spec.ts"
import type { Outcome } from "../verify.ts"
import { cell, cellLeft, type Fill, fit, type Row, type Run } from "./rows.ts"

/** The cursor's margin cell, then `[x] `: four for the box and its gap, one for the margin. */
const MARK = 5
/** Between every two columns, whatever is cut: `…-plugin-name1.2.0` read as one word. */
const GAP = 2
/** What a name keeps before a column beside it is given up so the name can stay readable. */
const NAME_FLOOR = 20
/** `latest  ⚠` and `@0.4.1` whole; a longer config is a path, and a path is cut from the left. */
const CONFIG_FLOOR = 12

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

/** The word the last column says, and its tone. Never cut: it is why a row is, or is not, selectable. */
function stateOf(plan: PluginPlan): Run {
  switch (plan.state) {
    case "update":
      return { text: "↑", tone: "added" }
    case "pin":
      return { text: "pin", tone: "warning" }
    case "unknown":
      return { text: "unreachable" }
    case "local":
      return { text: "local" }
    case "not-plugin":
      return { text: "not a plugin", tone: "warning" }
    default:
      return { text: "" }
  }
}

/** The widths `listRows` draws at; `0` is a column given up for the ones that matter more. */
export interface ListColumns {
  name: number
  running: number
  config: number
  published: number
  state: number
}

/**
 * Columns sized to what they hold, as Review's counts column is (docs/building/terminal-ui.md): the
 * widest entry plus a gap, between a floor and a cap, so spare width stays at the end of the row
 * rather than opening gaps between columns.
 *
 * When the row is short of room, the columns go in the order they stop mattering. The published
 * version and the state are what the dialog is for, so they always stay, and the state is never cut.
 * The name keeps `NAME_FLOOR`. Then `running` is kept, then `config` at its floor, and whatever is
 * left goes back to the name and then to `config`. At 60 columns the dialog used to keep `config` and
 * drop the version and the `↑` — a list of rows with no reason to tick any of them.
 */
export function listColumns(
  plans: readonly PluginPlan[],
  width: number,
  mark: number,
  configOf: (plan: PluginPlan) => string,
  nameOf: (plan: PluginPlan) => string,
): ListColumns {
  const widest = (texts: string[], floor: number, cap: number) =>
    Math.max(floor, Math.min(cap, Math.max(0, ...texts.map((t) => t.length)) + GAP))
  const published = widest(["published", "?", ...plans.map((p) => p.published ?? "")], 11, 20)
  // The last column: nothing after it needs a gap, and `fit` pads the row to the edge.
  const state = Math.max(0, ...plans.map((p) => stateOf(p).text.length))
  const wants = {
    name: widest(["plugin", ...plans.map(nameOf)], 12, 42),
    running: widest(["running", ...plans.map((p) => p.running ?? "")], 9, 20),
    config: widest(["config", ...plans.map(configOf)], 10, 30),
  }
  let room = width - mark - published - state
  const name = Math.max(0, Math.min(wants.name, NAME_FLOOR, room))
  room -= name
  const running = room >= wants.running ? wants.running : 0
  room -= running
  const config = room >= Math.min(wants.config, CONFIG_FLOOR) ? Math.min(wants.config, CONFIG_FLOOR) : 0
  room -= config
  const grown = Math.min(wants.name - name, room)
  room -= grown
  const more = config > 0 ? Math.min(wants.config - config, room) : 0
  return { name: name + grown, running, config: config + more, published, state }
}

/** Exactly `width`: the text in all but the last `GAP` columns, so a cut text never meets the next. */
const col = (text: string, width: number, left = false): string =>
  width <= GAP ? cell(text, width) : `${(left ? cellLeft : cell)(text, width - GAP)}${" ".repeat(GAP)}`

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

  const configOf = (plan: PluginPlan): string => {
    const label = configLabel(plan)
    if (plan.state === "local") return tildePath(label, home)
    /** `!`, not `⚠`: that one draws two cells wide in some terminals and shoves every column after it. */
    return plan.frozen && (plan.state === "update" || plan.state === "pin")
      ? `${label}  ${GLYPH.warn}`
      : label
  }
  // A local plugin with no package name is called by its path, and a path is cut from the left.
  const nameOf = (plan: PluginPlan): string => plan.label ?? tildePath(plan.name, home)
  const columns = listColumns(plans, width, mark, configOf, nameOf)
  const header: Row = {
    runs: fit(
      [
        { text: cell("", mark) },
        { text: col("plugin", columns.name), tone: "muted" },
        { text: col("running", columns.running), tone: "muted" },
        { text: col("config", columns.config), tone: "muted" },
        { text: col("published", columns.published), tone: "muted" },
      ],
      width,
    ),
  }
  const rows = plans.map((plan, i): Row => {
    const acting = plan.state === "update" || plan.state === "pin"
    const quiet = plan.state === "current" || plan.state === "unknown"
    const inert = plan.state === "internal" || plan.state === "local"
    /**
     * What this screen cannot act on is muted, and no more than muted. It used to be dimmed on top,
     * which took `local` and its path to about 2:1 against the background: below legible, on rows
     * that are still information someone opened the dialog to read. The missing checkbox and the
     * state column already say "nothing to do here".
     */
    const base = { tone: quiet || inert ? ("muted" as const) : ("text" as const) }
    const fill: Fill = selection?.cursor === i ? "cursor" : "none"
    const on = (run: Run): Run => ({ ...base, ...run, ...(fill === "none" ? {} : { fill }) })

    const configText = configOf(plan)
    const state = stateOf(plan)
    const runs: Run[] = [
      ...(selection
        ? [
            // The cursor is one coloured cell in the margin — the whole focus treatment, as in Review.
            on(selection.cursor === i ? { text: "▌", tone: "accent" } : { text: " " }),
            on({ text: cell(acting ? checkbox(selection.selected.has(plan.name)) : "", mark - 1) }),
          ]
        : []),
      on({ text: col(nameOf(plan), columns.name, plan.label === undefined && plan.state === "local") }),
      on({ text: col(plan.running ?? "", columns.running) }),
      on(
        acting && plan.frozen
          ? { text: col(configText, columns.config), tone: "warning" }
          : // A path is cut from the left: its end is the part that says which plugin it is.
            { text: col(configText, columns.config, plan.state === "local") },
      ),
      on(
        plan.state === "unknown"
          ? { text: col("?", columns.published), tone: "warning" }
          : {
              text: col(plan.published ?? "", columns.published),
              ...(acting ? { tone: "added" as const } : {}),
            },
      ),
      on({ ...state, text: cell(state.text, columns.state) }),
    ]
    return { runs: fit(runs, width, fill), target: plan.name }
  })
  const summary: Row[] =
    builtIn > 0
      ? [
          {
            runs: fit(
              [{ text: cell("", mark) }, { text: `${builtIn} built into OpenCode`, tone: "muted" }],
              width,
            ),
          },
        ]
      : []
  return [header, ...rows, ...summary]
}

function band(plan: PluginPlan, width: number): Row {
  // A pin changes the spec, not the version: `0.4.1 → 0.4.1` read as a bug to the first person who
  // saw one. Say what it is for instead.
  const frozen = configLabel(plan)
  const runs: Run[] =
    plan.state === "pin"
      ? [
          { text: cell(plan.name, Math.min(30, width)), bold: true, fill: "band" },
          { text: plan.published ?? "", tone: "added", fill: "band" },
          { text: `  ·  pin, so ${frozen} cannot freeze again`, tone: "muted", fill: "band" },
        ]
      : [
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
          outcome.ok
            ? { text: `${GLYPH.check}  `, tone: "success" }
            : { text: `${GLYPH.warn}  `, tone: "error" },
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
 * The footer's keys, in the shape and with the cutting every bay shares (client/design): `[key]` in
 * the accent, the label muted, three spaces between, whole hints dropped from the right when the row
 * is narrow — except `esc`, which is the last to go, because "how do I leave" is the first question a
 * dialog is asked — and a muted `…` when any were.
 */
export function keyRow(keys: readonly (readonly [string, string])[], width: number): Row {
  const hints: Hint[] = keys.map(([key, label]) => ({
    key,
    label,
    ...(key === "esc" ? { close: true } : {}),
  }))
  return { runs: fitHints(hints, width).runs }
}

/**
 * What a person has to do that this screen will not: an entry that names a package OpenCode cannot
 * load. Said under the list, once per entry, with the file to edit — the updater never writes config.
 */
export function noteRows(plans: readonly PluginPlan[], width: number, home?: string): Row[] {
  return plans
    .filter((plan) => plan.state === "not-plugin")
    .map((plan) => {
      const said = ` is not an OpenCode plugin — remove it from `
      const files = plan.files.map((f) => tildePath(f, home)).join(" and ")
      // The file is the point of the sentence, so a long path gives way from the left, never the end.
      const room = Math.max(12, width - 2 - plan.name.length - said.length)
      return {
        runs: fit(
          [
            { text: `${GLYPH.warn} `, tone: "warning" },
            { text: plan.name, bold: true },
            { text: said, tone: "muted" },
            { text: files.length > room ? cellLeft(files, room).trimEnd() : files, tone: "muted" },
          ],
          width,
        ),
        target: plan.name,
      }
    })
}
