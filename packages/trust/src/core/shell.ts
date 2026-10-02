/**
 * A command line, read the way Trust needs it: split into the commands it runs, each as words.
 *
 * Not a shell. It has one job and one direction to fail in: anything it cannot read *for certain* —
 * an expansion, a substitution, a subshell, a heredoc, a program that runs a string it was handed —
 * comes back `opaque`, and an opaque line is always asked. A reader that guesses would let the one
 * line it misread be approved by the approvals of another.
 *
 * Why not OpenCode's tree-sitter: one runtime dependency per package (docs/building/a-new-bay.md),
 * and a grammar still has to be told what "cannot be known statically" means — which is this file.
 */

import { posix } from "node:path"

export interface Command {
  /** `NAME=value` words before the program. They change what it does, so they are part of it. */
  env: string[]
  /** The program and its arguments, quotes removed. */
  argv: string[]
  /** Where it runs when an earlier `cd` on the same line moved it; absolute or relative as written. */
  cwd?: string
  /**
   * Which `argv` words are redirections the shell acts on (`>`, `2>&1`), as opposed to the same
   * characters quoted as an argument: `echo '>' x` writes nothing, `echo > x` writes a file, and by
   * text alone the two were one command. Absent on a command built by hand: then the text decides.
   */
  redirects?: number[]
}

export type Parsed = { kind: "commands"; commands: Command[] } | { kind: "opaque"; reason: string }

type Token = { type: "word"; text: string; redirect?: true } | { type: "op"; text: string }

class Opaque extends Error {}

/** Programs that run a string, a file or stdin as code: what they do is not on the line. */
const RUNS_CODE = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "eval", "source", ".", "exec"])
/** Directory moves that cannot be followed from the text alone. */
const MOVES = new Set(["pushd", "popd"])
/**
 * Shell grammar, not programs: `while true; do echo tick; sleep 2; done` is one loop, and read word by
 * word it became four "commands" — `while true`, `do echo tick`, `done` — each counting on its own.
 * What a loop or a condition runs depends on what it tests, which the text does not settle.
 */
const GRAMMAR = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "select",
  "function",
  "coproc",
  "{",
  "}",
  "[[",
  "!",
])

function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let word = ""
  /** A word can be empty and still exist: `echo ""` has an argument. */
  let started = false
  const flush = () => {
    if (started) tokens.push({ type: "word", text: word })
    word = ""
    started = false
  }
  const op = (text: string) => {
    flush()
    tokens.push({ type: "op", text })
  }
  const expansion = (next: string | undefined) => next !== undefined && /[({A-Za-z_0-9!?#@*$-]/.test(next)

  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    const next = line[i + 1]
    if (c === " " || c === "\t") {
      flush()
      continue
    }
    if (c === "\n") {
      op(";")
      continue
    }
    if (c === "#" && !started) {
      while (i < line.length && line[i] !== "\n") i++
      i--
      continue
    }
    if (c === "\\") {
      if (next === "\n") {
        i++
        continue
      }
      if (next === undefined) throw new Opaque("a trailing backslash")
      word += next
      started = true
      i++
      continue
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) throw new Opaque("an unclosed quote")
      word += line.slice(i + 1, end)
      started = true
      i = end
      continue
    }
    if (c === '"') {
      started = true
      let j = i + 1
      for (; j < line.length && line[j] !== '"'; j++) {
        const d = line[j] as string
        if (d === "`") throw new Opaque("a command substitution")
        if (d === "$" && expansion(line[j + 1])) throw new Opaque("an expansion")
        if (d === "\\" && /[$`"\\\n]/.test(line[j + 1] ?? "")) {
          word += line[j + 1]
          j++
          continue
        }
        word += d
      }
      if (j >= line.length) throw new Opaque("an unclosed quote")
      i = j
      continue
    }
    if (c === "`") throw new Opaque("a command substitution")
    if (c === "$" && expansion(next)) throw new Opaque("an expansion")
    if (c === "(" || c === ")") throw new Opaque("a subshell")
    if (c === "<" || c === ">") {
      if (next === "(") throw new Opaque("a process substitution")
      if (c === "<" && next === "<") throw new Opaque("a heredoc")
      /** `2>` and `2>&1`: a file descriptor is part of the redirection, not a word of its own. */
      const fd = /^\d+$/.test(word) ? word : ""
      if (!fd) flush()
      word = ""
      started = false
      let redirect = fd + c
      if (next === ">" || next === "&") {
        redirect += next
        i++
        if (next === "&" && /\d|-/.test(line[i + 1] ?? "")) {
          redirect += line[i + 1]
          i++
        }
      }
      tokens.push({ type: "word", text: redirect, redirect: true })
      continue
    }
    if (c === "&") {
      if (next === "&") {
        op("&&")
        i++
      } else if (next === ">") {
        flush()
        const redirect = line[i + 2] === ">" ? "&>>" : "&>"
        tokens.push({ type: "word", text: redirect, redirect: true })
        i += redirect.length - 1
      } else op("&")
      continue
    }
    if (c === "|") {
      if (next === "|" || next === "&") {
        op(`|${next}`)
        i++
      } else op("|")
      continue
    }
    if (c === ";") {
      op(";")
      if (next === ";") i++
      continue
    }
    word += c
    started = true
  }
  flush()
  return tokens
}

/**
 * Reads a command line into the commands it runs.
 *
 * `cd` is not returned as a command — it asks nothing by itself, as in OpenCode — but it moves every
 * command after it, and that is kept: `cd build && rm -rf *` and `cd /tmp && rm -rf *` are different
 * lines and must never share an approval.
 */
export function parse(line: string): Parsed {
  let tokens: Token[]
  try {
    tokens = tokenize(line)
  } catch (error) {
    if (error instanceof Opaque) return { kind: "opaque", reason: error.message }
    throw error
  }

  const commands: Command[] = []
  let cwd: string | undefined
  let words: { text: string; redirect: boolean }[] = []
  let piped = false

  const end = (after: string | undefined): Parsed | undefined => {
    const current = words
    words = []
    if (current.length === 0) return undefined
    const split = current.findIndex((w) => w.redirect || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text))
    const env = (split < 0 ? current : current.slice(0, split)).map((w) => w.text)
    const rest = split < 0 ? [] : current.slice(split)
    const argv = rest.map((w) => w.text)
    const redirects = rest.flatMap((w, i) => (w.redirect ? [i] : []))
    const program = argv[0]
    if (program !== undefined && RUNS_CODE.has(posix.basename(program))) {
      return { kind: "opaque", reason: `\`${program}\` runs code that is not on the line` }
    }
    if (program !== undefined && GRAMMAR.has(program)) {
      return { kind: "opaque", reason: `\`${program}\` is a loop or a condition, not a command` }
    }
    if (program !== undefined && MOVES.has(program)) {
      return { kind: "opaque", reason: `\`${program}\` moves where later commands run` }
    }
    if (program === "cd" && env.length === 0) {
      const target = argv[1]
      if (argv.length > 2 || target === "-" || piped || after === "|" || after === "|&") {
        return { kind: "opaque", reason: "a `cd` that cannot be followed" }
      }
      cwd =
        target === undefined
          ? "~"
          : cwd && !posix.isAbsolute(target) && !target.startsWith("~")
            ? posix.join(cwd, target)
            : target
      return undefined
    }
    commands.push({
      env,
      argv,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(redirects.length > 0 ? { redirects } : {}),
    })
    return undefined
  }

  for (const token of tokens) {
    if (token.type === "word") {
      words.push({ text: token.text, redirect: token.redirect === true })
      continue
    }
    const stop = end(token.text)
    if (stop) return stop
    piped = token.text === "|" || token.text === "|&"
  }
  const stop = end(undefined)
  if (stop) return stop
  return { kind: "commands", commands }
}
