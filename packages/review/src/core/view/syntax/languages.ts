/**
 * Every filetype the review knows how to colour.
 *
 * **This is the file to edit to add one.** An entry is the language's name, the filenames it answers
 * to, and which scanner reads it — usually `scanner()` with a set of words from `words.ts`. Nothing
 * else in the review needs to change; `languageOf` reads this table.
 *
 * A language missing from here is not broken, only uncoloured, which is why the table can grow by one
 * line at a time instead of needing to be complete.
 */

import { keyed } from "./keyed.ts"
import { prose } from "./prose.ts"
import { type Scanner, scanner } from "./scan.ts"
import * as words from "./words.ts"

export interface LanguageSpec {
  /** What the language is called. Ids are stable: the row cache and the tests use them. */
  id: string
  /** Extensions it answers to, without the dot. */
  extensions?: string[]
  /** Whole filenames, lowercased — for the files that carry a language without an extension. */
  filenames?: string[]
  /** The awkward ones: a dotfile, or a name with a version in it. Tried after the two lists. */
  matches?: (name: string) => boolean
  /** How a line of it is read. */
  scan: Scanner
}

/** A dotfile that is really a config script: `.zshrc`, `.gitignore`, `.npmrc`. */
const dotfile = (name: string) => name.startsWith(".") && /rc$|ignore$/.test(name)

export const LANGUAGES: LanguageSpec[] = [
  {
    id: "typescript",
    extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    scan: scanner({
      keywords: words.JS,
      literals: words.JS_VALUES,
      line: ["//"],
      block: ["/*", "*/"],
    }),
  },
  {
    id: "json",
    extensions: ["json", "jsonc", "json5"],
    /** Every bare word in JSON is a value, so nothing is a call and nothing is a type. */
    scan: scanner({
      literals: words.JSON_VALUES,
      line: ["//"],
      quotes: ['"'],
      stringsCanBeKeys: true,
      capitalsAreTypes: false,
      callsAreFunctions: false,
    }),
  },
  {
    id: "yaml",
    extensions: ["yml", "yaml", "toml", "ini", "cfg", "conf", "properties", "env"],
    filenames: [".env", ".editorconfig"],
    scan: keyed,
  },
  {
    id: "markdown",
    extensions: ["md", "markdown", "mdx", "mdc", "txt"],
    scan: prose,
  },
  {
    id: "shell",
    extensions: ["sh", "bash", "zsh", "fish", "ksh", "ps1"],
    filenames: ["dockerfile", "containerfile", "makefile", "justfile", "procfile", "brewfile"],
    matches: (name) => dotfile(name) || name.endsWith(".dockerfile") || name.startsWith("makefile."),
    /** A shell has no types, and `FROM` in a Dockerfile is a keyword whatever its case. */
    scan: scanner({
      keywords: words.SHELL,
      line: ["#"],
      capitalsAreTypes: false,
      ignoreCase: true,
    }),
  },
  {
    id: "python",
    extensions: ["py", "pyi", "pyw"],
    /** A docstring is the one thing in Python that crosses lines, and the commonest thing in a diff. */
    scan: scanner({
      keywords: words.PYTHON,
      literals: words.PYTHON_VALUES,
      line: ["#"],
      block: ['"""', '"""'],
    }),
  },
  {
    id: "go",
    extensions: ["go"],
    scan: scanner({
      keywords: words.GO,
      literals: words.GO_VALUES,
      line: ["//"],
      block: ["/*", "*/"],
    }),
  },
  {
    id: "rust",
    extensions: ["rs"],
    scan: scanner({
      keywords: words.RUST,
      literals: words.RUST_VALUES,
      line: ["//"],
      block: ["/*", "*/"],
    }),
  },
  {
    id: "curly",
    /** C and its descendants: the same shapes, near enough the same words. */
    extensions: ["c", "h", "cc", "cpp", "hpp", "cs", "java", "kt", "kts", "swift", "scala", "dart", "php"],
    scan: scanner({
      keywords: words.CURLY,
      literals: words.CURLY_VALUES,
      line: ["//"],
      block: ["/*", "*/"],
    }),
  },
  {
    id: "sql",
    extensions: ["sql", "psql"],
    scan: scanner({
      keywords: words.SQL,
      line: ["--"],
      block: ["/*", "*/"],
      capitalsAreTypes: false,
      ignoreCase: true,
    }),
  },
  {
    id: "css",
    extensions: ["css", "scss", "sass", "less"],
    scan: scanner({
      keywords: words.CSS,
      line: ["//"],
      block: ["/*", "*/"],
      capitalsAreTypes: false,
    }),
  },
  {
    id: "html",
    extensions: ["html", "htm", "xml", "svg", "vue", "svelte", "astro"],
    /** Tag names read as types and attributes as words, which is enough to see the shape of markup. */
    scan: scanner({ block: ["<!--", "-->"], quotes: ['"', "'"], callsAreFunctions: false }),
  },
]
