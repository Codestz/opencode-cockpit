/**
 * Code, coloured as code.
 *
 * A hand-written tokenizer rather than a dependency, for the reason every package here has exactly one
 * runtime dependency: a diff view needs keywords, strings, comments and numbers told apart, and that is
 * a hundred lines. OpenTUI does ship tree-sitter, which is better and is the upgrade path — it wants a
 * worker and an async round trip per file, so it is worth doing deliberately rather than on the way
 * past.
 *
 * The tones map onto the theme's own `syntax*` keys, so code in the review is colored exactly the way
 * the rest of OpenCode colors it.
 */

import type { Run, Tone } from "./rows.ts"

export type Language = "ts" | "json" | "markdown" | "shell" | "plain"

/** What a file is, from its name. Unknown means plain text, which is a fine thing to be. */
export function languageOf(path: string): Language {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return "ts"
  if (["json", "jsonc"].includes(ext)) return "json"
  if (["md", "markdown"].includes(ext)) return "markdown"
  if (["sh", "bash", "zsh", "fish"].includes(ext)) return "shell"
  return "plain"
}

const KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "new",
  "of",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "switch",
  "this",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "void",
  "while",
  "yield",
])

const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"])

/** Tokenizing is line by line, but a block comment is not — so the state crosses the boundary. */
export interface SyntaxState {
  inBlockComment: boolean
}

const isIdentStart = (char: string) => /[A-Za-z_$]/.test(char)
const isIdent = (char: string) => /[A-Za-z0-9_$]/.test(char)
const isDigit = (char: string) => /[0-9]/.test(char)

/**
 * One line of code as styled runs, and the state to carry into the next line.
 *
 * Deliberately not a parser: it reads left to right and never backtracks, which is what keeps it fast
 * enough to run on every visible line of every redraw.
 */
export function tokenize(
  text: string,
  language: Language,
  state: SyntaxState = { inBlockComment: false },
): {
  runs: Run[]
  state: SyntaxState
} {
  if (language === "plain" || language === "markdown") return { runs: [{ text, tone: "text" }], state }

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

    if (inBlockComment) {
      const end = rest.indexOf("*/")
      if (end === -1) {
        push(rest, "comment")
        at = text.length
      } else {
        push(rest.slice(0, end + 2), "comment")
        at += end + 2
        inBlockComment = false
      }
      continue
    }

    if (language === "ts" && rest.startsWith("/*")) {
      inBlockComment = true
      continue
    }

    const lineComment =
      (language === "ts" && rest.startsWith("//")) || (language === "shell" && rest.startsWith("#"))
    if (lineComment) {
      push(rest, "comment")
      break
    }

    const char = text[at] as string

    if (char === '"' || char === "'" || char === "`") {
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
      push(text.slice(at, end), "string")
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
      const word = text.slice(at, end)
      /** A name followed by `(` is being called; one that starts with a capital is a type. */
      const next = text.slice(end).trimStart()[0]
      const tone: Tone = KEYWORDS.has(word)
        ? "keyword"
        : LITERALS.has(word)
          ? "number"
          : next === "("
            ? "function"
            : /^[A-Z]/.test(word)
              ? "type"
              : "variable"
      push(word, language === "json" ? "variable" : tone)
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
