/**
 * Code, coloured as code.
 *
 * One scanner, configured per language by a table — rather than a dependency, for the reason every
 * package here has exactly one runtime dependency, and rather than two systems, which is what we had:
 * a tree-sitter path that needed a worker, an async round trip and a grammar per language, beside a
 * tokenizer that covered TypeScript. Two systems meant every filetype fell between them; one system
 * with a table means a filetype is a row.
 *
 * The tones map onto the theme's own `syntax*` keys, so code in the review is coloured exactly the way
 * the rest of OpenCode colours it.
 *
 * `registerLanguage` is the seam for filetypes we do not ship. A richer highlighter — Shiki, with real
 * grammars and a user's own theme — is a different shape entirely: asynchronous, and a whole file at a
 * time rather than a line. That is worth doing as an opt-in one day, and it is not this.
 */

import type { Run } from "../rows.ts"
import { LANGUAGES, type LanguageSpec } from "./languages.ts"
import type { SyntaxState } from "./scan.ts"

export type { LanguageSpec } from "./languages.ts"
export type { Grammar, Scanner, SyntaxState } from "./scan.ts"
export { scanner } from "./scan.ts"

/** A language's id, or `plain` for a file we have nothing to say about. */
export type Language = string

/** Text with no language: shown as itself, which is a perfectly good thing for text to be. */
export const PLAIN = "plain"

const known: LanguageSpec[] = [...LANGUAGES]
const byId = new Map(known.map((spec) => [spec.id, spec]))

/**
 * Teach the review a filetype it does not ship.
 *
 * Later registrations win, so a caller can also replace one of ours without editing the table.
 */
export function registerLanguage(spec: LanguageSpec): void {
  known.unshift(spec)
  byId.set(spec.id, spec)
}

/** Every language the review can colour, in the order they are tried. */
export function languages(): readonly LanguageSpec[] {
  return known
}

/** What a file is, from its name. */
export function languageOf(path: string): Language {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
  /**
   * A whole filename is the stronger claim, so it is asked of every language before any extension is:
   * `CMakeLists.txt` is CMake, though Markdown claims `.txt`.
   */
  const found =
    known.find((spec) => spec.filenames?.includes(name) || spec.matches?.(name)) ??
    (ext.length > 0 ? known.find((spec) => spec.extensions?.includes(ext)) : undefined)
  return found?.id ?? PLAIN
}

/**
 * One line of code as styled runs, and the state to carry into the next line.
 *
 * The state is what makes a block comment work: a line inside one has nothing in it that says so.
 */
export function tokenize(
  text: string,
  language: Language,
  state: SyntaxState = { inBlockComment: false },
): { runs: Run[]; state: SyntaxState } {
  const spec = byId.get(language)
  if (!spec) return { runs: [{ text, tone: "text" }], state: { inBlockComment: false } }
  return spec.scan(text, state)
}
