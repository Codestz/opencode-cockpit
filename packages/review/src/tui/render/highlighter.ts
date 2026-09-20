/**
 * The tree-sitter highlighter, on a leash.
 *
 * Every rule here exists because of something a probe showed or this repo has already been bitten by:
 *
 * - **Loaded lazily, never statically.** `@opentui/core` is a devDependency: it is not installed
 *   beside a published plugin and has to come from the host. A top-level import of it would take the
 *   whole bundle down — shell and statusline with it — if the host did not happen to provide it, so
 *   it is imported inside the try/catch that already knows what to do when highlighting is not
 *   available.
 * - **Never awaited on the draw path.** A file is highlighted in the background and drawn on the next
 *   frame. Probed outside a renderer, the client hung forever rather than failing, and a draw path
 *   that can hang is a frozen interface.
 * - **One strike.** If loading, initialising or highlighting fails, times out or throws, the whole
 *   thing is switched off for the session and the built-in tokenizer takes over. A highlighter that
 *   works sometimes is worse than one that never runs.
 * - **Cached by content.** Highlighting the same file on every keystroke would be a worker round trip
 *   per frame; the cache is keyed by the text itself, so an edit invalidates it and nothing else does.
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { filetypeFor, type HighlightedLine, type Highlighter } from "../../core/view/highlight.ts"

/** How long the client gets before it is assumed to be hanging. */
const PATIENCE_MS = 2_000

/** The theme's syntax colours, for tree-sitter to style with, so highlighting matches the host. */
const stylesFor = (theme: TuiThemeCurrent) => ({
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

interface Chunk {
  text: string
  fg?: unknown
  attributes?: number
}

/** Chunks come back for the whole file; the view draws lines, so split on the newlines. */
const toLines = (chunks: readonly Chunk[]): HighlightedLine[] => {
  const lines: HighlightedLine[] = [{ spans: [] }]
  for (const chunk of chunks) {
    const parts = String(chunk.text).split("\n")
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ spans: [] })
      if (part.length === 0) return
      const span: HighlightedLine["spans"][number] = { text: part }
      if (chunk.fg) span.color = chunk.fg
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
  let parsed = false
  /** Filetypes this build has no grammar for: asked once, then left alone. */
  const unsupported = new Set<string>()

  const key = (path: string, source: string) => [path, source.length, source.slice(0, 64)].join("|")

  return {
    active: () => !broken && parsed,
    lines: (path, source) => cache.get(key(path, source)),
    request(path, source, language, onReady) {
      if (broken) return
      const filetype = filetypeFor(language, path)
      if (!filetype || unsupported.has(filetype)) return
      const id = key(path, source)
      if (cache.has(id) || asked.has(id)) return
      asked.add(id)

      /** Fire and forget, with a timer that gives up on a client that is not answering. */
      void (async () => {
        try {
          const core = (await import("@opentui/core")) as {
            getTreeSitterClient: () => unknown
            SyntaxStyle: { fromStyles: (styles: Record<string, unknown>) => unknown }
            treeSitterToStyledText: (
              source: string,
              filetype: string,
              style: unknown,
              client: unknown,
            ) => Promise<{ chunks: Chunk[] }>
          }
          const styled = await Promise.race([
            core.treeSitterToStyledText(
              source,
              filetype,
              core.SyntaxStyle.fromStyles(stylesFor(theme())),
              core.getTreeSitterClient(),
            ),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), PATIENCE_MS)),
          ])
          cache.set(id, toLines(styled.chunks))
          parsed = true
          onReady()
        } catch (error) {
          /**
           * One strike for a client that is not answering — but not for a file it cannot parse.
           *
           * A missing grammar is a fact about that filetype, not a sign the parser is broken, and
           * treating the two the same is how one unparseable file left everything else uncoloured
           * for the rest of the session.
           */
          const message = error instanceof Error ? error.message : String(error)
          const unparseable = /parser|filetype|language|grammar|unsupported/i.test(message)
          if (unparseable) {
            unsupported.add(filetype)
            return
          }
          broken = true
          cache.clear()
        }
      })()
    },
  }
}
