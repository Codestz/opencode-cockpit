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

import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { BADGE_RULE, badgeText, type Kind, kindOf, shortDetail, watchLabel } from "./view.ts"

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

/** Every part's text, in the order the row draws them. */
export const sidebarRowText = (row: SidebarRow): string =>
  `${row.rule}${row.label}${row.title}${row.watch}${row.detail}`

export function sidebarRow(shell: ShellInfo, now: number, frame: number, width: number): SidebarRow {
  const kind = kindOf(shell)
  const badge = badgeText(kind, frame)
  const label = badge.slice(BADGE_RULE.length)
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
    rule: BADGE_RULE,
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
