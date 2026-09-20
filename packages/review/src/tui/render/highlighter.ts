/**
 * The tree-sitter highlighter, on a leash.
 *
 * Every rule here exists because of something the probe showed or this repo has already been bitten by:
 *
 * - **Never awaited on the draw path.** A file is highlighted in the background and drawn on the next
 *   frame. The probe hung forever outside a renderer, and a draw path that can hang is a frozen TUI.
 * - **One strike.** If initialising or highlighting fails, times out, or throws, the whole thing is
 *   switched off for the session and the tokenizer takes over. A highlighter that works sometimes is
 *   worse than one that never runs.
 * - **Cached by content.** Highlighting the same file on every keystroke would be a worker round trip
 *   per frame; the cache is keyed by the text itself, so an edit invalidates it and nothing else does.
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { getTreeSitterClient, type StyledText, SyntaxStyle, treeSitterToStyledText } from "@opentui/core"
import { filetypeFor, type HighlightedLine, type Highlighter } from "../../core/view/highlight.ts"

/** How long the client gets before it is assumed to be hanging. */
const PATIENCE_MS = 2_000

const hex = (colour: { r: number; g: number; b: number }): string => {
  const part = (value: number) =>
    Math.round(value <= 1 ? value * 255 : value)
      .toString(16)
      .padStart(2, "0")
  return `#${part(colour.r)}${part(colour.g)}${part(colour.b)}`
}

/** The theme's syntax colours, handed to tree-sitter so highlighting matches the rest of OpenCode. */
const styleFor = (theme: TuiThemeCurrent): SyntaxStyle =>
  SyntaxStyle.fromStyles({
    keyword: { fg: theme.syntaxKeyword, bold: true },
    "keyword.import": { fg: theme.syntaxKeyword, bold: true },
    string: { fg: theme.syntaxString },
    "string.special": { fg: theme.syntaxString },
    comment: { fg: theme.syntaxComment, italic: true },
    number: { fg: theme.syntaxNumber },
    boolean: { fg: theme.syntaxNumber },
    constant: { fg: theme.syntaxNumber },
    type: { fg: theme.syntaxType },
    "type.builtin": { fg: theme.syntaxType },
    function: { fg: theme.syntaxFunction },
    "function.method": { fg: theme.syntaxFunction },
    variable: { fg: theme.syntaxVariable },
    property: { fg: theme.syntaxVariable },
    operator: { fg: theme.syntaxOperator },
    punctuation: { fg: theme.syntaxPunctuation },
    "punctuation.bracket": { fg: theme.syntaxPunctuation },
    "punctuation.delimiter": { fg: theme.syntaxPunctuation },
    default: { fg: theme.text },
  })

/** Chunks come back for the whole file; the view draws lines, so split on the newlines. */
const toLines = (styled: StyledText): HighlightedLine[] => {
  const lines: HighlightedLine[] = [{ spans: [] }]
  for (const chunk of styled.chunks) {
    const parts = String(chunk.text).split("\n")
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ spans: [] })
      if (part.length === 0) return
      const span: HighlightedLine["spans"][number] = { text: part }
      if (chunk.fg) span.color = hex(chunk.fg as unknown as { r: number; g: number; b: number })
      // Bit 1 is bold and bit 3 italic in OpenTUI's attribute mask.
      if (typeof chunk.attributes === "number") {
        if (chunk.attributes & 1) span.bold = true
        if (chunk.attributes & 4) span.italic = true
      }
      lines.at(-1)?.spans.push(span)
    })
  }
  return lines
}

export function createHighlighter(theme: () => TuiThemeCurrent): Highlighter {
  const cache = new Map<string, HighlightedLine[]>()
  const asked = new Set<string>()
  let broken = false

  const key = (path: string, source: string) => [path, source.length, source.slice(0, 64)].join("|")

  return {
    active: () => !broken && cache.size > 0,
    lines: (path, source) => cache.get(key(path, source)),
    request(path, source, language, onReady) {
      if (broken) return
      const filetype = filetypeFor(language, path)
      if (!filetype) return
      const id = key(path, source)
      if (cache.has(id) || asked.has(id)) return
      asked.add(id)

      /** Fire and forget, with a timer that gives up on a client that is not answering. */
      void (async () => {
        try {
          const client = getTreeSitterClient()
          const styled = await Promise.race([
            treeSitterToStyledText(source, filetype, styleFor(theme()), client),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), PATIENCE_MS)),
          ])
          cache.set(id, toLines(styled))
          onReady()
        } catch {
          /** One strike: a highlighter that works sometimes is worse than one that never runs. */
          broken = true
          cache.clear()
        }
      })()
    },
  }
}
