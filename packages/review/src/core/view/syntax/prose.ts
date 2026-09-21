/**
 * Prose, with the few marks in it that carry meaning.
 *
 * Markdown used to arrive as plain text, which in a repository full of documentation meant most of a
 * review was uncoloured. It is not code and should not be coloured like code — a heading, a fence, a
 * quote, a list marker, a code span and a link is the whole of what is worth saying about it.
 */

import type { Run } from "../rows.ts"
import type { Scanner } from "./scan.ts"

export const prose: Scanner = (text, state) => ({ runs: lineOf(text), state })

function lineOf(text: string): Run[] {
  const heading = /^(\s*)(#{1,6}\s.*)$/.exec(text)
  if (heading)
    return [{ text: heading[1] as string }, { text: heading[2] as string, tone: "keyword", bold: true }]
  if (/^\s*(```|~~~)/.test(text)) return [{ text, tone: "comment" }]
  if (/^\s*>/.test(text)) return [{ text, tone: "comment" }]

  const list = /^(\s*)([-*+]|\d+\.)(\s.*)$/.exec(text)
  if (list)
    return [
      { text: list[1] as string },
      { text: list[2] as string, tone: "operator" },
      ...inline(list[3] as string),
    ]
  return inline(text)
}

/** The parts of a line of prose that are not prose: code spans, bold, links. */
function inline(text: string): Run[] {
  const runs: Run[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > at) runs.push({ text: text.slice(at, start), tone: "text" })
    const value = match[0]
    runs.push({
      text: value,
      tone: value.startsWith("`") ? "string" : value.startsWith("[") ? "function" : "text",
      bold: value.startsWith("**"),
    })
    at = start + value.length
  }
  if (at < text.length) runs.push({ text: text.slice(at), tone: "text" })
  return runs.length > 0 ? runs : [{ text, tone: "text" }]
}
