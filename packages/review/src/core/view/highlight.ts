/**
 * Real syntax highlighting, when it is available, and honest colouring when it is not.
 *
 * OpenTUI ships tree-sitter — a parser, not a set of patterns — with typescript, javascript and
 * markdown grammars already on disk, and a `SyntaxStyle` that takes *our* colours. That is the right
 * answer for this bay: no new dependency, a real parse, and code that comes out in whatever theme you
 * are using rather than in a highlighter's own palette. (Shiki would also be a real highlighter, and a
 * multi-megabyte dependency shipping its own themes — two things this repo has good reasons to avoid.)
 *
 * The catch, found by probing it: outside a renderer the client **hangs** rather than failing. So
 * nothing here is ever awaited on the draw path. A file is highlighted in the background, cached, and
 * drawn on the next frame; until then — and forever, if the client misbehaves once — the built-in
 * tokenizer colours the code.
 */

import type { Language } from "./syntax.ts"

/** What a highlighter hands back: one array of coloured spans per line. */
export interface HighlightedLine {
  /**
   * `color` is whatever the highlighter produced — an OpenTUI `RGBA`, passed straight through to the
   * renderer. Deliberately untyped here: this file is pure and must not import the terminal library,
   * and converting to hex and back would lose precision for nothing.
   */
  spans: { text: string; color?: unknown; bold?: boolean; italic?: boolean }[]
}

export interface Highlighter {
  /** Lines for this file, if they are ready. Never blocks, never throws. */
  lines: (path: string, source: string) => HighlightedLine[] | undefined
  /** Asks for this file to be highlighted; `onReady` fires once, if it succeeds. */
  request: (path: string, source: string, language: Language, onReady: () => void) => void
  /** Whether a real highlighter is doing the work, for saying so on screen. */
  active: () => boolean
}

/** Tree-sitter's filetype names, for the grammars that ship with OpenTUI. */
const FILETYPES: Partial<Record<Language, string>> = {
  ts: "typescript",
  json: "json",
  markdown: "markdown",
}

export const filetypeFor = (language: Language, path: string): string | undefined => {
  /**
   * TSX asks for the typescript grammar, not a `tsx` one.
   *
   * OpenTUI ships typescript, javascript and markdown; there is no `tsx` parser to find, so asking
   * for one failed — and failure used to switch highlighting off for the whole session, which is how
   * opening one `.tsx` file left every other file uncoloured.
   */
  void path
  return FILETYPES[language]
}

/** A highlighter that never highlights: the honest default until the real one has proved itself. */
export const noHighlighter: Highlighter = {
  lines: () => undefined,
  request: () => {},
  active: () => false,
}
