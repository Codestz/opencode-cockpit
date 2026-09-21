/**
 * One scanner, configured per language.
 *
 * Every language a diff is likely to contain wants the same five things told apart — keywords,
 * strings, numbers, comments, punctuation — and differs only in which words are keywords and how a
 * comment starts. So the scanner is written once and a language is a table of those differences.
 * Adding a language is then data, not code, which is the whole point: see `languages.ts`.
 */

import type { Run, Tone } from "../rows.ts"

/** Scanning is line by line, but a block comment is not — so the state crosses the boundary. */
export interface SyntaxState {
  inBlockComment: boolean
}

export type Scanner = (text: string, state: SyntaxState) => { runs: Run[]; state: SyntaxState }

/** What one language does differently from the others. Everything here is optional. */
export interface Grammar {
  /** Words that are the language itself. */
  keywords?: Set<string>
  /** Words that are values: `true`, `null`, `None`, `nil`. */
  literals?: Set<string>
  /** How a comment to the end of the line starts — more than one, for languages with a choice. */
  line?: string[]
  /** How a comment that crosses lines opens and closes. */
  block?: [string, string]
  /** Which quotes open a string. */
  quotes?: string[]
  /** Whether a capitalised word is a type. True of most languages, untrue of shell. */
  capitalsAreTypes?: boolean
  /** Whether a word before `(` is a call. */
  callsAreFunctions?: boolean
  /** Whether a string before `:` is a key, as in JSON. */
  stringsCanBeKeys?: boolean
  /** Whether case matters when matching a word — it does not in SQL, or in a Dockerfile. */
  ignoreCase?: boolean
}

const DEFAULTS = {
  quotes: ['"', "'", "`"],
  capitalsAreTypes: true,
  callsAreFunctions: true,
} satisfies Partial<Grammar>

const isIdentStart = (char: string) => /[A-Za-z_$@]/.test(char)
const isIdent = (char: string) => /[A-Za-z0-9_$-]/.test(char)
const isDigit = (char: string) => /[0-9]/.test(char)

/**
 * A left-to-right scanner for one grammar.
 *
 * Deliberately not a parser: it never backtracks, which is what keeps it fast enough to run on every
 * visible line of every redraw — and a diff only ever needs to know what *kind* of thing a run of
 * characters is, never how the program is shaped.
 */
export function scanner(grammar: Grammar): Scanner {
  const rules = { ...DEFAULTS, ...grammar }
  const fold = (set?: Set<string>) =>
    rules.ignoreCase && set ? new Set([...set].map((word) => word.toLowerCase())) : set
  const keywords = fold(rules.keywords)
  const literals = fold(rules.literals)
  const look = (word: string) => (rules.ignoreCase ? word.toLowerCase() : word)

  return (text, state) => {
    const runs: Run[] = []
    let at = 0
    let inBlockComment = state.inBlockComment
    const push = (value: string, tone: Tone) => {
      if (value.length === 0) return
      const last = runs.at(-1)
      if (last && last.tone === tone) last.text += value
      else runs.push({ text: value, tone })
    }

    while (at < text.length) {
      const rest = text.slice(at)

      if (rules.block && inBlockComment) {
        const end = rest.indexOf(rules.block[1])
        if (end === -1) {
          push(rest, "comment")
          break
        }
        push(rest.slice(0, end + rules.block[1].length), "comment")
        at += end + rules.block[1].length
        inBlockComment = false
        continue
      }

      if (rules.block && rest.startsWith(rules.block[0])) {
        inBlockComment = true
        push(rules.block[0], "comment")
        at += rules.block[0].length
        continue
      }

      if (rules.line?.some((mark) => rest.startsWith(mark))) {
        push(rest, "comment")
        break
      }

      const char = text[at] as string

      if (rules.quotes.includes(char)) {
        let end = at + 1
        while (end < text.length) {
          if (text[end] === "\\") {
            end += 2
            continue
          }
          if (text[end] === char) {
            end++
            break
          }
          end++
        }
        const value = text.slice(at, end)
        /** A quoted key reads as a key, not as prose that happens to sit before a colon. */
        const key = rules.stringsCanBeKeys && text.slice(end).trimStart().startsWith(":")
        push(value, key ? "keyword" : "string")
        at = end
        continue
      }

      if (isDigit(char)) {
        let end = at
        while (end < text.length && /[0-9a-fA-FxXbBoO._]/.test(text[end] as string)) end++
        push(text.slice(at, end), "number")
        at = end
        continue
      }

      if (isIdentStart(char)) {
        let end = at
        while (end < text.length && isIdent(text[end] as string)) end++
        /**
         * A start character that is not also a continuation character — `@` alone, before a bracket or
         * a space — matched none of itself, and the loop advanced by nothing. Every branch in here must
         * move `at`, without exception: a scanner that stops moving does not throw, it *spins*, and a
         * spinning line-scanner takes the whole interface thread with it. That is the freeze that had
         * to be killed by closing OpenCode, and it had no stack to find because nothing ever failed.
         */
        if (end === at) end = at + 1
        const word = text.slice(at, end)
        const next = text.slice(end).trimStart()[0]
        push(
          word,
          keywords?.has(look(word))
            ? "keyword"
            : literals?.has(look(word))
              ? "number"
              : rules.callsAreFunctions && next === "("
                ? "function"
                : rules.capitalsAreTypes && /^[A-Z]/.test(word)
                  ? "type"
                  : "variable",
        )
        at = end
        continue
      }

      if (/[{}[\]().,;:]/.test(char)) {
        push(char, "punct")
        at++
        continue
      }

      if (/[+\-*/%=<>!&|?^~]/.test(char)) {
        push(char, "operator")
        at++
        continue
      }

      push(char, "text")
      at++
    }

    return { runs, state: { inBlockComment } }
  }
}
