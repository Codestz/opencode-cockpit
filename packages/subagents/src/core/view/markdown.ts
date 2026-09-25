/**
 * A subagent's answer as rows: the markdown it writes, drawn rather than shown as source.
 *
 * Only what agents actually write: headings, **bold**, `code`, lists, quotes and fenced code. Inline
 * styles survive wrapping — a line is cut into styled words first, then the words are laid out —
 * so a path in `code` that crosses the edge keeps its colour on both lines.
 */

import { fit, type Row, type Run, widthOf } from "./rows.ts"

type Style = Omit<Run, "text">

/** `**bold**` and `` `code` `` in one line, as styled pieces. */
export function inline(text: string, base: Style): Run[] {
  const out: Run[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) out.push({ ...base, text: text.slice(last, at) })
    const token = match[0]
    if (token.startsWith("**")) out.push({ ...base, text: token.slice(2, -2), bold: true })
    else out.push({ ...base, text: token.slice(1, -1), tone: "tool" })
    last = at + token.length
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) })
  return out
}

/**
 * Styled pieces onto lines of `width`, word by word. `first` leads the first line and `rest` every
 * line after it — a bullet, then the indent that lines up under the words.
 */
export function flow(pieces: readonly Run[], width: number, first: Run[], rest: Run[]): Row[] {
  const words: Run[] = []
  for (const piece of pieces) {
    for (const part of piece.text.split(/(\s+)/)) if (part) words.push({ ...piece, text: part })
  }
  const lines: Row[] = []
  let line: Row = [...first]
  let used = widthOf(first.map((run) => run.text).join(""))
  const lead = () => widthOf(rest.map((run) => run.text).join(""))
  const empty = () => line.every((run) => rest.includes(run) || first.includes(run))
  for (const word of words) {
    const w = widthOf(word.text)
    const space = /^\s+$/.test(word.text)
    if (used + w > width && !empty()) {
      lines.push(line)
      line = [...rest]
      used = lead()
      if (space) continue
    }
    if (space && empty()) continue
    if (w > width - used) {
      // A word longer than the line: cut it where the line ends.
      let text = word.text
      while (widthOf(text) > width - used) {
        let head = ""
        for (const char of text) {
          if (widthOf(head) + widthOf(char) > width - used) break
          head += char
        }
        if (!head) break
        line.push({ ...word, text: head })
        lines.push(line)
        line = [...rest]
        used = lead()
        text = text.slice(head.length)
      }
      if (text) {
        line.push({ ...word, text })
        used += widthOf(text)
      }
      continue
    }
    line.push(word)
    used += w
  }
  if (line.length > 0) lines.push(line)
  return lines
}

export interface MarkdownOptions {
  /** Columns of margin on the left of every row. */
  indent: number
}

export function markdownRows(text: string, width: number, { indent }: MarkdownOptions): Row[] {
  const pad: Run = { text: " ".repeat(indent) }
  const room = Math.max(8, width)
  const rows: Row[] = []
  let fence = false
  let blank = false
  const push = (row: Row) => {
    rows.push(fit(row, width))
    blank = false
  }
  const gap = () => {
    if (!blank && rows.length > 0) rows.push(fit([], width))
    blank = true
  }

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+$/, "")
    if (/^\s*```/.test(line)) {
      fence = !fence
      if (fence) gap()
      continue
    }
    if (fence) {
      push([pad, { text: "│ ", tone: "muted", fill: "block" }, { text: line, tone: "text", fill: "block" }])
      continue
    }
    if (line.trim() === "") {
      gap()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      gap()
      const level = (heading[1] as string).length
      const base: Style = level <= 2 ? { tone: "accent", bold: true } : { tone: "text", bold: true }
      for (const row of flow(inline(heading[2] as string, base), room, [pad], [pad])) push(row)
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      const depth = Math.min(3, Math.floor((bullet[1] as string).length / 2))
      const lead = " ".repeat(depth * 2)
      const first: Run[] = [pad, { text: `${lead}• `, tone: "muted" }]
      const rest: Run[] = [pad, { text: `${lead}  ` }]
      for (const row of flow(inline(bullet[2] as string, { tone: "text" }), room, first, rest)) push(row)
      continue
    }
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      const mark = `${numbered[2]}. `
      const first: Run[] = [pad, { text: mark, tone: "muted" }]
      const rest: Run[] = [pad, { text: " ".repeat(mark.length) }]
      for (const row of flow(inline(numbered[3] as string, { tone: "text" }), room, first, rest)) push(row)
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      const first: Run[] = [pad, { text: "▎ ", tone: "border" }]
      for (const row of flow(inline(quote[1] as string, { tone: "muted" }), room, first, first)) push(row)
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      push([pad, { text: "─".repeat(Math.max(0, Math.min(room - indent, 40))), tone: "border" }])
      continue
    }
    for (const row of flow(inline(line, { tone: "text" }), room, [pad], [pad])) push(row)
  }
  while (rows.length > 0 && rows.at(-1)?.every((run) => run.text.trim() === "")) rows.pop()
  return rows
}
