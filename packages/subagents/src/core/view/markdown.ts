/**
 * A subagent's answer as rows: the markdown it writes, drawn rather than shown as source.
 *
 * Only what agents actually write: headings, **bold**, *emphasis*, `code`, [links](…), ~~strikes~~,
 * lists, quotes and fenced code. Inline styles survive wrapping — a line is cut into styled words
 * first, then the words are laid out — so a path in `code` that crosses the edge keeps its colour on
 * both lines.
 */

import { fit, type Row, type Run, spread, widthOf } from "./rows.ts"

type Style = Omit<Run, "text">

/**
 * The inline tokens, in the order they win: a code span first, so nothing inside it is read as
 * markup. Emphasis wants a word character on neither side, so `snake_case` and `a * b` stay text.
 */
const INLINE =
  /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]\n]+\]\([^)\s]+\)|(?<![\w*])\*(?![\s*])[^*\n]*?[^\s*]\*(?![\w*])|(?<![\w_])_(?![\s_])[^_\n]*?[^\s_]_(?![\w_]))/g

/**
 * `**bold**`, `*emphasis*`, `` `code` ``, `[text](url)` and `~~strike~~` in one line, as styled
 * pieces. Emphasis is `faint`, which the pane draws in italics. OpenTUI has no strikethrough, so a
 * strike is drawn faint and muted — read as "not this" without a glyph pretending to cross it out.
 */
export function inline(text: string, base: Style): Run[] {
  const out: Run[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > last) out.push({ ...base, text: text.slice(last, at) })
    const token = match[0]
    if (token.startsWith("`")) out.push({ ...base, text: token.slice(1, -1), tone: "tool" })
    else if (token.startsWith("**") || token.startsWith("__"))
      out.push({ ...base, text: token.slice(2, -2), bold: true })
    else if (token.startsWith("~~"))
      out.push({ ...base, text: token.slice(2, -2), tone: "muted", faint: true })
    else if (token.startsWith("[")) {
      /** The words are the link; where it goes follows, muted, for whoever wants to copy it. */
      const close = token.indexOf("](")
      out.push({ ...base, text: token.slice(1, close) })
      out.push({ ...base, text: ` ${token.slice(close + 2, -1)}`, tone: "muted", bold: false })
    } else out.push({ ...base, text: token.slice(1, -1), faint: true })
    last = at + token.length
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) })
  return out
}

/**
 * Markdown as one line of plain words, for a folded preview: fences, heading marks, list markers,
 * quote bars and inline markup gone, whitespace run together. Cut to `most` characters first, so a
 * long block of thinking is not read to the end to show its first sixty columns.
 */
export function plain(text: string, most = 4000): string {
  return text
    .slice(0, most)
    .split("\n")
    .filter((line) => !/^\s*```/.test(line) && !/^\s*([-*_])\1{2,}\s*$/.test(line))
    .map((line) =>
      inline(line.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, ""), {})
        .map((run) => run.text)
        .join(""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
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
      /**
       * Measured only as far as the line reaches, and the head counted as it grows: a 100 kB word
       * measured whole on every row it is cut into took a second to draw.
       */
      while (widthOf(text, width - used) > width - used) {
        let head = ""
        let taken = 0
        for (const char of text) {
          const w = widthOf(char)
          if (taken + w > width - used) break
          head += char
          taken += w
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
  const bar: Run = { text: "│ ", tone: "muted", fill: "block" }
  let fence = false
  /** The open fence's language (```` ```tsx ````), until its first row has shown it. */
  let label: Run[] | undefined
  let blank = false
  /** The last list item's hanging indent, for a line that continues it indented underneath. */
  let item: Run[] | undefined
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
    const under = item
    item = undefined
    const marker = /^\s*```\s*([\w+#.-]*)/.exec(line)
    if (marker) {
      /** A fence that closes with no line in it still says what it was. */
      if (fence && label) push([pad, bar, ...label])
      fence = !fence
      label = fence && marker[1] ? [{ text: ` ${marker[1]} `, tone: "muted", fill: "block" }] : undefined
      if (fence) gap()
      continue
    }
    if (fence) {
      const code: Row = [pad, bar, { text: line, tone: "text", fill: "block" }]
      /** The language rides the fence's first row, right-aligned, where it costs no row of its own. */
      push(label ? spread(code, label, width) : code)
      label = undefined
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
      item = rest
      continue
    }
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      const mark = `${numbered[2]}. `
      const first: Run[] = [pad, { text: mark, tone: "muted" }]
      const rest: Run[] = [pad, { text: " ".repeat(mark.length) }]
      for (const row of flow(inline(numbered[3] as string, { tone: "text" }), room, first, rest)) push(row)
      item = rest
      continue
    }
    if (under && /^\s/.test(line)) {
      for (const row of flow(inline(line.trim(), { tone: "text" }), room, under, under)) push(row)
      item = under
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
