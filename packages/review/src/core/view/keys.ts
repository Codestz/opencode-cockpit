/**
 * `[?] Keys`: every key the review takes, in the body's place.
 *
 * The footer has room for the keys you use constantly and says `…` for the rest; this is the rest, one
 * line each, what each does wrapped under its own column rather than cut — the same screen Trust and
 * Shell have, so `?` means the same thing in every bay.
 */

import { keyName } from "@opencode-cockpit/client/design"
import { clipRuns, type Row, type Run, wrapText } from "./rows.ts"

export interface KeyLine {
  keys: string[]
  does: string
}

/** In the order a review is done: move, read, say something, finish — then the pane itself. */
export const REVIEW_KEYS: readonly KeyLine[] = [
  { keys: ["j/k", "↑/↓"], does: "Move: files in the list, lines in the diff" },
  { keys: ["tab"], does: "Switch between the file list and the diff" },
  {
    keys: ["enter", "l"],
    does: "Open the file under the cursor, or fold a folder; in the diff, fold the file",
  },
  { keys: ["h", "←"], does: "Back to the file list" },
  { keys: ["d", "u"], does: "Scroll down or up a few lines (also pgdn, pgup)" },
  {
    keys: ["L", "H"],
    does: "Scroll the code sideways, for lines longer than the pane (also shift+→, shift+←)",
  },
  { keys: ["v"], does: "Select lines; the cursor is the moving end" },
  { keys: ["c", "n"], does: "Comment on the line or the selection — or reply, on a thread" },
  { keys: ["f"], does: "Comment on the whole file" },
  { keys: ["x"], does: "Remove the thread here" },
  { keys: ["space", "m"], does: "Mark the file viewed and go to the next one that is not" },
  { keys: ["z"], does: "Fold or unfold the file" },
  { keys: ["o"], does: "Open an image or other binary in your system's viewer — both versions" },
  { keys: ["s"], does: "Hand the review to the agent" },
  { keys: ["b"], does: "Next source: uncommitted work, or what this branch changes" },
  { keys: ["B"], does: "Choose the branch to compare against" },
  { keys: ["g"], does: "Read the changes again" },
  { keys: ["w"], does: "Right pane or full screen" },
  { keys: ["p"], does: "Show what the review costs to draw" },
  { keys: ["?", "esc"], does: "Hide these keys; esc again closes the review" },
]

const key = (name: string): Run => ({ text: `[${keyName(name)}]`, tone: "accent", bold: true })

/** One key line: its keys in a column, what it does wrapped beside them. */
function keyLineRows(line: KeyLine, column: number, width: number): Row[] {
  const keys = line.keys.flatMap((name, at): Run[] => [...(at > 0 ? [{ text: " " }] : []), key(name)])
  const used = keys.reduce((sum, run) => sum + run.text.length, 0)
  const indent = 1 + column + 3
  return wrapText(line.does, Math.max(1, width - indent - 1)).map((text, at) => ({
    runs: clipRuns(
      [
        { text: " " },
        ...(at === 0
          ? [...keys, { text: " ".repeat(column - used + 3) }]
          : [{ text: " ".repeat(indent - 1) }]),
        { text, tone: "muted" },
      ],
      width,
    ),
  }))
}

/** As many key lines as fit in `height` rows; a list cut short says how many keys are below. */
export function keyRows(width: number, height: number, list: readonly KeyLine[] = REVIEW_KEYS): Row[] {
  const column = Math.max(
    ...list.map((each) => each.keys.map((name) => `[${keyName(name)}]`).join(" ").length),
  )
  const rows: Row[] = [{ runs: clipRuns([{ text: " KEYS", tone: "text", bold: true }], width) }]
  rows.push({ runs: [{ text: " ".repeat(width) }] })
  let shown = 0
  for (const line of list) {
    const lines = keyLineRows(line, column, width)
    const last = shown === list.length - 1
    if (rows.length + lines.length > (last ? height : height - 1)) break
    rows.push(...lines)
    shown++
  }
  if (shown < list.length) {
    const left = list.length - shown
    rows.push({
      runs: clipRuns(
        [{ text: ` ↓ ${left} more key${left === 1 ? "" : "s"} — a taller pane shows them`, tone: "muted" }],
        width,
      ),
    })
  }
  while (rows.length < height) rows.push({ runs: [{ text: " ".repeat(width) }] })
  return rows.slice(0, height)
}
