import { describe, expect, test } from "bun:test"
import {
  languageOf,
  languages,
  registerLanguage,
  scanner,
  tokenize,
} from "../../src/core/view/syntax/index.ts"

const tones = (text: string, state?: { inBlockComment: boolean }) =>
  tokenize(text, "typescript", state).runs.map((run) => [run.text, run.tone])

const text = (line: string, language: string) =>
  tokenize(line, language)
    .runs.map((run) => run.text)
    .join("")

const toneOf = (line: string, language: string, word: string) =>
  tokenize(line, language).runs.find((run) => run.text.trim() === word)?.tone

describe("what a file is", () => {
  test("by extension", () => {
    expect(languageOf("src/core/view/layout.ts")).toBe("typescript")
    expect(languageOf("src/tui/index.tsx")).toBe("typescript")
    expect(languageOf("a/b/tsconfig.json")).toBe("json")
    expect(languageOf("README.md")).toBe("markdown")
    expect(languageOf("scripts/release.sh")).toBe("shell")
    expect(languageOf(".github/workflows/ci.yml")).toBe("yaml")
    expect(languageOf("main.go")).toBe("go")
    expect(languageOf("lib.rs")).toBe("rust")
    expect(languageOf("app/models.py")).toBe("python")
    expect(languageOf("schema.sql")).toBe("sql")
    expect(languageOf("styles/app.css")).toBe("css")
    expect(languageOf("index.html")).toBe("html")
    expect(languageOf("src/Main.java")).toBe("curly")
  })

  /** A repository is full of files that carry a language without carrying an extension. */
  test("by name, for the files that have no extension to read", () => {
    expect(languageOf("Dockerfile")).toBe("shell")
    expect(languageOf("Makefile")).toBe("shell")
    expect(languageOf("justfile")).toBe("shell")
    expect(languageOf(".zshrc")).toBe("shell")
    expect(languageOf(".gitignore")).toBe("shell")
    expect(languageOf(".env")).toBe("yaml")
  })

  test("and is content not to know", () => {
    expect(languageOf("LICENSE")).toBe("plain")
    expect(languageOf("bun.lockb")).toBe("plain")
  })
})

/**
 * The point of the table: a filetype is a row, and adding one changes nothing else. This is the seam a
 * user's own grammar — or one day a Shiki-backed one — arrives through.
 */
describe("the table anyone can add to", () => {
  test("a registered language is found by name and colours its own words", () => {
    registerLanguage({
      id: "lua",
      extensions: ["lua"],
      scan: scanner({ keywords: new Set(["local", "function", "end"]), line: ["--"] }),
    })
    expect(languageOf("plugin/init.lua")).toBe("lua")
    expect(toneOf("local name = 1", "lua", "local")).toBe("keyword")
    expect(languages().some((each) => each.id === "lua")).toBe(true)
  })

  test("a language nobody registered is shown as itself rather than guessed at", () => {
    expect(tokenize("const not really code", "plain").runs).toEqual([
      { text: "const not really code", tone: "text" },
    ])
    expect(tokenize("¿anything?", "esperanto").runs).toEqual([{ text: "¿anything?", tone: "text" }])
  })
})

describe("reading a line", () => {
  test("tells keywords, names and punctuation apart", () => {
    expect(tones("const open = false")).toEqual([
      ["const", "keyword"],
      [" ", "text"],
      ["open", "variable"],
      [" ", "text"],
      ["=", "operator"],
      [" ", "text"],
      ["false", "number"],
    ])
  })

  test("a name followed by a bracket is a call; a capital is a type", () => {
    expect(toneOf("new Store(config)", "typescript", "Store")).toBe("function")
    expect(toneOf("let it: Thread = x", "typescript", "Thread")).toBe("type")
  })

  test("strings keep their quotes and survive escapes", () => {
    expect(tones('"a \\" b"')).toEqual([['"a \\" b"', "string"]])
  })

  test("a line comment swallows the rest of the line", () => {
    expect(tones("let x = 1 // and the rest")).toContainEqual(["// and the rest", "comment"])
  })

  test("a block comment carries across lines", () => {
    const first = tokenize("/* opened", "typescript")
    expect(first.state.inBlockComment).toBe(true)
    const second = tokenize(" still inside", "typescript", first.state)
    expect(second.runs).toEqual([{ text: " still inside", tone: "comment" }])
    const third = tokenize(" closed */ after", "typescript", second.state)
    expect(third.state.inBlockComment).toBe(false)
    expect(third.runs[0]).toEqual({ text: " closed */", tone: "comment" })
  })

  /** Whatever a scanner does, it may never lose or invent a character. */
  test("every run together is the original line, in every language", () => {
    const lines: [string, string][] = [
      ['export const x = { a: "b", n: 42 } // note', "typescript"],
      ['  "name": "cockpit",', "json"],
      ["  - run: bun run check # the gate", "yaml"],
      ["## A heading with `code` and a [link](url)", "markdown"],
      ["def run(self, at: int) -> None:  # go", "python"],
      ["SELECT id FROM threads WHERE open = true; -- all of them", "sql"],
      ["func main() { fmt.Println(nil) }", "go"],
      ["  .row { color: var(--fg); } /* tint */", "css"],
      ['<div class="row">text</div>', "html"],
    ]
    for (const [line, language] of lines) expect(text(line, language)).toBe(line)
  })
})

describe("languages that are not curly braces", () => {
  test("a JSON key reads as a key, not as prose before a colon", () => {
    expect(toneOf('  "name": "cockpit",', "json", '"name"')).toBe("keyword")
    expect(toneOf('  "name": "cockpit",', "json", '"cockpit"')).toBe("string")
  })

  test("YAML and TOML are keys, values and comments", () => {
    const runs = tokenize("  timeout: 30 # seconds", "yaml").runs
    expect(runs.find((run) => run.text === "timeout")?.tone).toBe("keyword")
    expect(runs.at(-1)?.tone).toBe("comment")
  })

  test("markdown is prose, with its marks", () => {
    expect(tokenize("## Slots", "markdown").runs.at(-1)).toEqual({
      text: "## Slots",
      tone: "keyword",
      bold: true,
    })
    expect(toneOf("use `tokenize` here", "markdown", "`tokenize`")).toBe("string")
  })

  test("case does not matter where the language says it does not", () => {
    expect(toneOf("select id from t", "sql", "select")).toBe("keyword")
    expect(toneOf("FROM oven/bun:1 AS base", "shell", "FROM")).toBe("keyword")
  })

  test("a shell has no types, so a capitalised word is just a word", () => {
    expect(toneOf("echo $HOME", "shell", "echo")).toBe("variable")
  })
})

/**
 * The freeze.
 *
 * A start character that was not also a continuation character — `@` before a bracket — made the
 * scanner's identifier branch advance by nothing, and the loop spun on the same character forever.
 * Nothing threw, so there was no stack and no toast and no log: the interface thread simply stopped,
 * and the only way out was closing OpenCode. One line of one file in this repository did it.
 *
 * So the test is not "handle `@`". It is that every character advances, on every language.
 */
describe("a scanner that stops moving takes the session with it", () => {
  const LANGUAGES = ["typescript", "json", "shell", "python", "go", "rust", "curly", "sql", "css", "html"]

  test("the line that froze the review", () => {
    const line = String.raw`  const ctrl = /^(?:ctrl|control|c)[+-]([a-z@[\\\]^_])$/.exec(key)`
    expect(text(line, "typescript")).toBe(line)
  })

  test("every printable character, in every language, in three positions", () => {
    for (let code = 32; code < 127; code++) {
      const char = String.fromCharCode(code)
      for (const language of LANGUAGES) {
        for (const line of [char, `x ${char} y`, `x${char}`, `${char}${char}`, `(${char})`]) {
          expect(text(line, language)).toBe(line)
        }
      }
    }
  })

  test("every pair of printable characters, where one branch hands off to another", () => {
    /** `@[` was the pair that did it: a word starts, and the next character is not part of one. */
    for (let first = 32; first < 127; first++) {
      for (let second = 32; second < 127; second++) {
        const line = String.fromCharCode(first) + String.fromCharCode(second)
        expect(text(line, "typescript")).toBe(line)
      }
    }
  })

  test("an unclosed block comment ends the line rather than the session", () => {
    const first = tokenize("/* opened and never", "typescript")
    expect(first.state.inBlockComment).toBe(true)
    expect(text(" still going", "typescript")).toBe(" still going")
  })

  test("a docstring, whose opener and closer are the same characters", () => {
    expect(text('"""one line"""', "python")).toBe('"""one line"""')
    const opened = tokenize('    """', "python")
    expect(opened.state.inBlockComment).toBe(true)
  })
})

describe("Ruby", () => {
  test("is known by its extensions and its bare filenames", () => {
    expect(languageOf("app/models/user.rb")).toBe("ruby")
    expect(languageOf("lib/tasks/db.rake")).toBe("ruby")
    expect(languageOf("cockpit.gemspec")).toBe("ruby")
    expect(languageOf("config.ru")).toBe("ruby")
    expect(languageOf("Gemfile")).toBe("ruby")
    expect(languageOf("Rakefile")).toBe("ruby")
  })

  test("keywords, values, comments and strings", () => {
    const line = "def greet(name) # say hello"
    expect(toneOf(line, "ruby", "def")).toBe(toneOf("if x", "python", "if"))
    expect(toneOf("return nil", "ruby", "nil")).toBe(toneOf("return None", "python", "None"))
    expect(tokenize(line, "ruby").runs.at(-1)?.text).toContain("# say hello")
    expect(text('puts "hi"', "ruby")).toBe('puts "hi"')
  })

  test("=begin … =end is a comment across lines", () => {
    const first = tokenize("=begin", "ruby")
    expect(first.state.inBlockComment).toBe(true)
    const inside = tokenize("  not code", "ruby", first.state)
    expect(inside.runs.every((run) => run.tone === inside.runs[0]?.tone)).toBe(true)
    expect(tokenize("=end", "ruby", inside.state).state.inBlockComment).toBe(false)
  })
})

describe("the languages real repositories have", () => {
  const cases: [string, string][] = [
    ["infra/main.tf", "hcl"],
    ["prod/terraform.tfvars", "hcl"],
    ["live/prod/terragrunt.hcl", "hcl"],
    ["jobs/api.nomad", "hcl"],
    ["init.lua", "lua"],
    ["lib/app/router.ex", "elixir"],
    ["mix.exs", "elixir"],
    ["src/Main.hs", "haskell"],
    ["src/Main.elm", "haskell"],
    ["flake.nix", "nix"],
    ["schema.graphql", "graphql"],
    ["api/v1/user.proto", "proto"],
    ["script.pl", "perl"],
    ["analysis.R", "r"],
    ["model.jl", "julia"],
    ["src/core.clj", "lisp"],
    ["init.el", "lisp"],
    ["lib/parser.ml", "ml"],
    ["Program.fs", "ml"],
    ["CMakeLists.txt", "cmake"],
    ["cmake/deps.cmake", "cmake"],
    ["prisma/schema.prisma", "prisma"],
    ["build.bat", "batch"],
    ["Jenkinsfile", "curly"],
    ["build.gradle", "curly"],
    ["App.m", "curly"],
    ["Token.sol", "curly"],
    ["main.zig", "curly"],
    ["setup.pyx", "python"],
  ]
  test.each(cases)("%s is %s", (path, language) => {
    expect(languageOf(path)).toBe(language)
  })

  test("the ones that were already there still are", () => {
    expect(languageOf("notes.txt")).toBe("markdown")
    expect(languageOf("index.ts")).toBe("typescript")
    expect(languageOf("app.jsx")).toBe("typescript")
    expect(languageOf("main.py")).toBe("python")
    expect(languageOf("Dockerfile")).toBe("shell")
    expect(languageOf(".gitignore")).toBe("shell")
  })

  const comment = (line: string, language: string) =>
    tokenize(line, language).runs.find((run) => run.text.includes("note"))?.tone
  test.each([
    ['resource "aws_s3_bucket" "b" { # note', "hcl"],
    ['name = "x" // note', "hcl"],
    ["local x = 1 -- note", "lua"],
    ["x = 1 # note", "elixir"],
    ["main = 1 -- note", "haskell"],
    ["{ a = 1; } # note", "nix"],
    ["type Query { # note", "graphql"],
    ["message A {} // note", "proto"],
    ["(defn f [] 1) ; note", "lisp"],
    ["set(X 1) # note", "cmake"],
    ["rem note", "batch"],
  ])("%s — the comment is a comment (%s)", (line, language) => {
    expect(comment(line, language)).toBe(comment("// note", "typescript"))
  })

  test("HCL's keywords are keywords", () => {
    expect(toneOf('resource "aws_s3_bucket" "b" {', "hcl", "resource")).toBe(
      toneOf("const x", "typescript", "const"),
    )
    expect(toneOf('dependency "vpc" {', "hcl", "dependency")).toBe(toneOf("const x", "typescript", "const"))
  })
})
