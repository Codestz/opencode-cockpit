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
    extensions: ["py", "pyi", "pyw", "pyx", "pxd"],
    filenames: ["sconstruct", "sconscript"],
    /** A docstring is the one thing in Python that crosses lines, and the commonest thing in a diff. */
    scan: scanner({
      keywords: words.PYTHON,
      literals: words.PYTHON_VALUES,
      line: ["#"],
      block: ['"""', '"""'],
    }),
  },
  {
    id: "ruby",
    extensions: ["rb", "rake", "gemspec", "ru"],
    filenames: ["gemfile", "rakefile", "guardfile", "podfile", "vagrantfile"],
    /** `=begin` … `=end` is Ruby's block comment; everything else is a `#`. */
    scan: scanner({
      keywords: words.RUBY,
      literals: words.RUBY_VALUES,
      line: ["#"],
      block: ["=begin", "=end"],
    }),
  },
  {
    id: "hcl",
    /** Terraform, Terragrunt (`terragrunt.hcl`), Packer, Nomad — HCL, with all three of its comments. */
    extensions: ["tf", "tfvars", "hcl", "tftest", "nomad", "tfbackend"],
    scan: scanner({
      keywords: words.HCL,
      literals: words.JSON_VALUES,
      line: ["#", "//"],
      block: ["/*", "*/"],
      quotes: ['"'],
      capitalsAreTypes: false,
    }),
  },
  {
    id: "lua",
    extensions: ["lua", "luau"],
    scan: scanner({ keywords: words.LUA, literals: words.LUA_VALUES, line: ["--"], block: ["--[[", "]]"] }),
  },
  {
    id: "elixir",
    extensions: ["ex", "exs", "heex", "eex"],
    scan: scanner({
      keywords: words.ELIXIR,
      literals: words.RUBY_VALUES,
      line: ["#"],
      block: ['"""', '"""'],
    }),
  },
  {
    id: "haskell",
    extensions: ["hs", "lhs", "elm", "purs"],
    scan: scanner({
      keywords: words.HASKELL,
      literals: words.HASKELL_VALUES,
      line: ["--"],
      block: ["{-", "-}"],
    }),
  },
  {
    id: "nix",
    extensions: ["nix"],
    scan: scanner({
      keywords: words.NIX,
      literals: words.JSON_VALUES,
      line: ["#"],
      block: ["/*", "*/"],
      capitalsAreTypes: false,
    }),
  },
  {
    id: "graphql",
    extensions: ["graphql", "gql", "graphqls"],
    scan: scanner({
      keywords: words.GRAPHQL,
      literals: words.JSON_VALUES,
      line: ["#"],
      block: ['"""', '"""'],
    }),
  },
  {
    id: "proto",
    extensions: ["proto"],
    scan: scanner({ keywords: words.PROTO, literals: words.JSON_VALUES, line: ["//"], block: ["/*", "*/"] }),
  },
  {
    id: "perl",
    extensions: ["pl", "pm", "t", "psgi"],
    scan: scanner({
      keywords: words.PERL,
      literals: words.PERL_VALUES,
      line: ["#"],
      block: ["=pod", "=cut"],
    }),
  },
  {
    id: "r",
    extensions: ["r", "rmd"],
    scan: scanner({ keywords: words.R, literals: words.R_VALUES, line: ["#"] }),
  },
  {
    id: "julia",
    extensions: ["jl"],
    scan: scanner({ keywords: words.JULIA, literals: words.JULIA_VALUES, line: ["#"], block: ["#=", "=#"] }),
  },
  {
    id: "lisp",
    extensions: ["clj", "cljs", "cljc", "edn", "el", "scm", "ss", "rkt", "lisp", "lsp", "fnl"],
    scan: scanner({
      keywords: words.LISP,
      literals: words.LISP_VALUES,
      line: [";"],
      quotes: ['"'],
      capitalsAreTypes: false,
      callsAreFunctions: false,
    }),
  },
  {
    id: "ml",
    extensions: ["ml", "mli", "fs", "fsi", "fsx"],
    scan: scanner({
      keywords: words.ML,
      literals: words.ML_VALUES,
      line: ["//"],
      block: ["(*", "*)"],
      quotes: ['"'],
    }),
  },
  {
    id: "cmake",
    extensions: ["cmake"],
    filenames: ["cmakelists.txt"],
    scan: scanner({
      keywords: words.CMAKE,
      literals: words.CMAKE_VALUES,
      line: ["#"],
      quotes: ['"'],
      capitalsAreTypes: false,
      ignoreCase: true,
    }),
  },
  {
    id: "prisma",
    extensions: ["prisma"],
    scan: scanner({ keywords: words.PRISMA, literals: words.JSON_VALUES, line: ["//"], quotes: ['"'] }),
  },
  {
    id: "batch",
    extensions: ["bat", "cmd"],
    scan: scanner({
      keywords: words.BATCH,
      line: ["rem ", "REM ", "::"],
      quotes: ['"'],
      capitalsAreTypes: false,
      ignoreCase: true,
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
    extensions: [
      ...["c", "h", "cc", "cpp", "cxx", "c++", "hpp", "hh", "hxx", "ino", "m", "mm", "cs", "java"],
      ...["kt", "kts", "swift", "scala", "sc", "sbt", "dart", "php", "groovy", "gradle", "sol", "zig"],
    ],
    filenames: ["jenkinsfile"],
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
