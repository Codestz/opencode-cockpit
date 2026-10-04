/**
 * One shell in the sidebar, as the parts of a row exactly `width` columns wide.
 *
 * The row used to be the badge, the title cut at a fixed twenty characters, then the detail and the
 * watch wherever the title happened to end — `5m watch tsc ✗` under `exit 1` under `4m ago`, each at a
 * different column. The fixed cut assumed a 26-column sidebar; OpenCode's is closer to 40, so most
 * of every title was cut to leave space empty. Now the title takes what the row has left, and the
 * facts are flush right, the way Subagents draws its block: the eye runs down one edge.
 *
 * Parts rather than coloured runs: which colour each part is drawn in stays where it was decided,
 * in `kindColor` and `watchColor`, and the preview paints through the same two.
 */

import {
  emptyBlock,
  FEWER_TEXT,
  HEADING_GAP,
  moreText,
  type State as Shared,
  summaryRuns,
  warnRows,
} from "@opencode-cockpit/client/design"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import type { Row, Run } from "./console.ts"
import { badgeText, type Kind, kindOf, kindTone, STATE, shortDetail, watchLabel, watchTone } from "./view.ts"

export interface SidebarRow {
  kind: Kind
  /** The rule, coloured apart from its label as the badge always was. */
  rule: string
  /** `⠹ RUN`, `FAIL ` — the rest of the fixed seven columns. */
  label: string
  /** The title, cut with `…` and padded, so whatever follows lands flush right. */
  title: string
  /** `watch tsc ✗` and the gap after it, or nothing. */
  watch: string
  /** `5m`, `exit 1`, `4m ago`: the last thing on the row, always against the right edge. */
  detail: string
}

/** What a title keeps before the facts beside it give way: below this a name says nothing. */
const TITLE_FLOOR = 8

const cut = (text: string, width: number): string => {
  if (width <= 0) return ""
  if (text.length <= width) return text.padEnd(width)
  return width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

/** The heading's summary, `1 run · 1 fail · 2 done`: short enough for the narrowest sidebar. */
export function sidebarCounts(list: readonly ShellInfo[]): string {
  const of = (kind: Kind) => list.filter((s) => kindOf(s) === kind).length
  return [
    of("run") ? `${of("run")} run` : "",
    of("fail") ? `${of("fail")} fail` : "",
    of("done") + of("stop") ? `${of("done") + of("stop")} done` : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

export interface FoldInput<T> {
  /** Every shell the block is about, in order. */
  all: readonly T[]
  /** The ones the folded view keeps — running, recent failures, the selection — in order. */
  folded: readonly T[]
  /** Expanded by a click on `+ N more`. */
  showAll: boolean
  /** Rows folded, and rows expanded. */
  rows: number
  expandedRows: number
}

export interface Fold<T> {
  shown: T[]
  /** Shells not shown: what `+ N more` counts. */
  more: number
  /**
   * The row under the shells: `more` offers to unfold, `fewer` to fold back, `both` is expanded and
   * still cut by the expanded limit. None when folding would hide nothing.
   */
  toggle?: "more" | "fewer" | "both"
  /**
   * Expanded, but the folded view would show every shell now: the expansion should reset itself. It
   * outlived the shells it was for — expanded at six, down to one, the block still offered
   * `− fewer` for a list nothing could fold.
   */
  stale: boolean
}

/**
 * What the block shows, and whether it offers to fold or unfold. The toggle is there only while
 * folding hides something; expanded with nothing left to hide, the expansion is stale.
 */
export function fold<T>(input: FoldInput<T>): Fold<T> {
  const rows = Math.max(1, input.rows)
  const folded = input.folded.slice(0, rows)
  const folds = input.all.length > folded.length
  const expanded = input.showAll && folds
  const shown = expanded ? input.all.slice(0, Math.max(rows, input.expandedRows)) : folded
  const more = input.all.length - shown.length
  const toggle = !folds ? undefined : !expanded ? "more" : more > 0 ? "both" : "fewer"
  return { shown, more, ...(toggle ? { toggle } : {}), stale: input.showAll && !folds }
}

/** Every part's text, in the order the row draws them. */
export const sidebarRowText = (row: SidebarRow): string =>
  `${row.rule}${row.label}${row.title}${row.watch}${row.detail}`

export function sidebarRow(shell: ShellInfo, now: number, frame: number, width: number): SidebarRow {
  const kind = kindOf(shell)
  const badge = badgeText(kind, frame)
  /** The badge has no rule of its own any more (`▌` means the cursor, client/design): all label. */
  const label = badge
  const detail = shortDetail(shell, now)
  const watch = watchLabel(shell)
  /** One column after the badge, one before the facts: the title is never flush against either. */
  const room = width - badge.length - 2
  /**
   * The facts give way in the order they stop mattering, and only once the title is down to its
   * floor. A watch is a health signal and `exit 1` is a failure, so they outlast a running time.
   */
  const choices: [string, string][] = [[watch, detail], kind === "run" ? [watch, ""] : ["", detail], ["", ""]]
  /** The watch and the gap after it — a gap only when there is a detail for it to stand off from. */
  const watchPart = (w: string, d: string) => (w && d ? `${w}  ` : w)
  const [keptWatch, keptDetail] = choices.find(
    ([w, d]) => room - watchPart(w, d).length - d.length >= TITLE_FLOOR || (!w && !d),
  ) ?? ["", ""]
  const watchText = watchPart(keptWatch, keptDetail)
  const titleWidth = Math.max(0, room - watchText.length - keptDetail.length)
  const row: SidebarRow = {
    kind,
    rule: "",
    label,
    title: ` ${cut(shell.title, titleWidth)} `,
    watch: watchText,
    detail: keptDetail,
  }
  if (sidebarRowText(row).length <= width) return row
  /** A column narrower than the badge and a gap: the badge, cut, and nothing pretending to fit. */
  const badgeOnly = badge.slice(0, Math.max(0, width)).padEnd(Math.max(0, width))
  return { ...row, rule: badgeOnly.slice(0, 1), label: badgeOnly.slice(1), title: "", watch: "", detail: "" }
}

export interface BlockInput {
  list: readonly ShellInfo[]
  now: number
  /** The spinner's clock. */
  frame: number
  width: number
  /** Expanded by a click on `+ N more`. */
  showAll?: boolean
  hideWhenEmpty?: boolean
  /** Settings to fix, as sentences (client/settings `noticeText`): `!` rows under the block. */
  notices?: readonly string[]
}

/** Exactly `width` cells: cut with `…`, or padded. */
function fit(row: Row, width: number): Row {
  const out: Row = []
  let used = 0
  for (const run of row) {
    if (used >= width) break
    const room = width - used
    const text = run.text.length > room ? `${run.text.slice(0, Math.max(0, room - 1))}…` : run.text
    out.push({ ...run, text })
    used += text.length
  }
  if (used < width) out.push({ text: " ".repeat(width - used) })
  return out
}

/**
 * The Shells block as rows of tones, as `components/sidebar.tsx` draws it: the name left and every
 * count flush right with no row of air, the shells folded to the ones still worth a look, `+ N more`
 * under them, and any settings notice last. The preview CLI prints it and the site draws it; a theme
 * turns the tones into colours.
 */
export function sidebarBlock(input: BlockInput): Row[] {
  const { list, now, frame, width } = input
  const warnings = (input.notices ?? []).flatMap((text) => warnRows(text, width).map((row) => row as Row))
  if (list.length === 0)
    return [
      ...emptyBlock("Shells", width, input.hideWhenEmpty === true && warnings.length === 0).map(
        (row) => row as Row,
      ),
      ...warnings,
    ]
  const folding = fold({
    all: list,
    folded: list.filter((shell) => kindOf(shell) === "run" || kindOf(shell) === "fail"),
    showAll: input.showAll === true,
    rows: 5,
    expandedRows: 12,
  })
  const tally: Partial<Record<Shared, number>> = {}
  for (const shell of list) tally[STATE[kindOf(shell)]] = (tally[STATE[kindOf(shell)]] ?? 0) + 1
  const counts = summaryRuns(tally, Math.max(8, width - "Shells ".length))
  const used = "Shells".length + counts.reduce((n, part) => n + part.text.length, 0)
  const heading: Row = [
    { text: "Shells", bold: true },
    { text: " ".repeat(Math.max(1, width - used)) },
    ...counts.map((part): Run => ({ text: part.text, tone: part.tone ?? "muted" })),
  ]
  const rows = folding.shown.map((shell): Row => {
    const row = sidebarRow(shell, now, frame, width)
    const tone = kindTone(kindOf(shell))
    return fit(
      [
        { text: row.rule, tone },
        { text: row.label, tone, bold: true },
        { text: row.title },
        { text: row.watch, tone: watchTone(shell) },
        { text: row.detail, tone: "muted" },
      ],
      width,
    )
  })
  const toggle = folding.toggle
    ? [
        fit(
          [{ text: `  ${folding.toggle === "fewer" ? FEWER_TEXT : moreText(folding.more)}`, tone: "muted" }],
          width,
        ),
      ]
    : []
  return [
    fit(heading, width),
    ...Array.from({ length: HEADING_GAP }, () => fit([], width)),
    ...rows,
    ...toggle,
    ...warnings,
  ]
}
