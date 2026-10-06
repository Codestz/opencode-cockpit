/**
 * What a command does to the machine, read from its words: does it only read, does a flag make it
 * write a file, does a flag make it run another program.
 *
 * Two questions lean on this, from opposite sides:
 *
 * - **What a widening never covers** (`family.outside`). A widened `sed` was "any sed", and every
 *   `sed -i` with it — a redirection was the only write it saw. `writesByFlag` and `runsByFlag` are
 *   that check for the flags that make a program write or launch something (#44). A blocklist, so it
 *   misses: the reason widening stays a person's decision.
 * - **What may be learned as a family** (`readOnly`). An allowlist, so it fails closed: a program not
 *   in `PROGRAMS` with `read: true`, or one whose arguments say anything this table does not know to
 *   be harmless, is not a read — it keeps earning trust one exact command at a time, as before.
 *
 * `sed` is a read only when its script is read here and only prints (`sed -n '1,50p'`, `s/a/b/g`):
 * `w`, `e` and anything unusual are not. Kept out on purpose: `awk` (`system()`, `print > f` — its
 * script is not read here), `find` (`-exec`, `-delete`), `less`
 * and `more` (`!` opens a shell), `xargs` (runs whatever it is given), interpreters.
 */

import { posix } from "node:path"
import { dangerOf, subcommand, TOOL_GLOBALS, unwrapOnce } from "./danger.ts"
import type { Command } from "./shell.ts"

interface Program {
  /** It only reads, unless a check below says otherwise. */
  read?: true
  /** Why its arguments make it write a file, if they do. */
  writes?: (args: readonly string[]) => string | undefined
  /** Why its arguments make it run another program, if they do. */
  runs?: (args: readonly string[]) => string | undefined
  /** For a read: why these arguments are not one after all (a subcommand that changes things). */
  only?: (args: readonly string[]) => string | undefined
}

/* ─── reading flags ──────────────────────────────────────────────────────────────────────────── */

const isFlag = (word: string) => word.startsWith("-") && word !== "-" && word !== "--"

/** Words before `--`: after it everything is an operand, `-i` included. */
const flagsOf = (args: readonly string[]): string[] => {
  const end = args.indexOf("--")
  return (end < 0 ? args : args.slice(0, end)).filter(isFlag)
}

/** `--output`, `--output=x`. */
const long = (args: readonly string[], ...names: string[]) =>
  flagsOf(args).find((flag) => names.some((name) => flag === name || flag.startsWith(`${name}=`)))

/**
 * A short letter, alone or in a cluster: `-i`, `-ni`, `-i.bak`, `-pi`. A cluster's attached value can
 * hold the letter too (`-e's/i/x/'`); that reads as the flag, which is the safe side.
 */
const short = (args: readonly string[], letter: string) =>
  flagsOf(args).find((flag) => !flag.startsWith("--") && flag.slice(1).includes(letter))

/** Operands: what is not a flag. A flag's value counts as one — more operands is the safe side. */
const operands = (args: readonly string[]): string[] => {
  const end = args.indexOf("--")
  const before = (end < 0 ? args : args.slice(0, end)).filter((word) => !isFlag(word))
  return end < 0 ? before : [...before, ...args.slice(end + 1)]
}

const flag =
  (why: string, longs: readonly string[], letters = "") =>
  (args: readonly string[]): string | undefined => {
    const found = long(args, ...longs) ?? [...letters].map((letter) => short(args, letter)).find(Boolean)
    return found === undefined ? undefined : `${found} ${why}`
  }

const IN_PLACE = "rewrites files in place"
const OUTPUT = "writes a file"
const RUNS = "runs another program"

/* ─── the table ──────────────────────────────────────────────────────────────────────────────── */

const READ: Program = { read: true }

/** `git` subcommands that only look, whatever follows. Anything not here or in `GIT_SOMETIMES` is not a read. */
export const GIT_READS: ReadonlySet<string> = new Set([
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "describe",
  "shortlog",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "cat-file",
  "merge-base",
  "grep",
  "check-ignore",
  "ls-remote",
  "for-each-ref",
  "name-rev",
  "count-objects",
  "whatchanged",
])

const listing = (args: readonly string[]) => args.length === 0 || ["list", "show"].includes(args[0] as string)

/**
 * `git` subcommands that read in one form and write in another — the reading form, exactly. Each gets
 * the words after the subcommand. `git branch foo` makes a branch; `git branch -r --contains x` looks.
 */
const GIT_SOMETIMES: Readonly<Record<string, (args: readonly string[]) => boolean>> = {
  branch: (args) => {
    const LOOKS =
      /^(-a|-r|-v|-vv|-l|--list|--all|--remotes|--show-current|--verbose|--contains|--no-contains|--merged|--no-merged|--points-at|--format(=.*)?|--sort(=.*)?|--color(=.*)?|--no-color|--column|--no-column)$/
    const TAKES = new Set([
      "--contains",
      "--no-contains",
      "--merged",
      "--no-merged",
      "--points-at",
      "--sort",
      "--format",
    ])
    for (let i = 0; i < args.length; i++) {
      const word = args[i] as string
      /** A pattern to list by is a word, and only with `--list`; any other flag may delete or move. */
      if (!LOOKS.test(word)) return !word.startsWith("-") && (args.includes("-l") || args.includes("--list"))
      if (TAKES.has(word)) i++
    }
    return true
  },
  /** `stash list`, `stash show`; a bare `git stash` stashes. */
  stash: (args) => args.length > 0 && listing(args),
  worktree: (args) => args[0] === "list",
  /** `reflog` is `reflog show`; `expire` and `delete` rewrite it. */
  reflog: (args) => args.length === 0 || args[0] === "show" || (args[0] as string).startsWith("-"),
  remote: (args) =>
    args.length === 0 ||
    /^(-v|--verbose)$/.test(args[0] as string) ||
    ["show", "get-url"].includes(args[0] as string),
  tag: (args) => args.length === 0 || args.some((word) => word === "-l" || word === "--list"),
  config: (args) =>
    args.some((word) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(word)) &&
    !args.some((word) =>
      /^(--unset|--unset-all|--add|--replace-all|--rename-section|--remove-section|--edit|-e)$/.test(word),
    ),
}

const PROGRAMS: Readonly<Record<string, Program>> = {
  ls: READ,
  cat: READ,
  head: READ,
  tail: READ,
  wc: READ,
  grep: READ,
  egrep: READ,
  fgrep: READ,
  echo: READ,
  printf: READ,
  pwd: READ,
  which: READ,
  whereis: READ,
  type: READ,
  stat: READ,
  du: READ,
  df: READ,
  cut: READ,
  tr: READ,
  jq: READ,
  diff: READ,
  cmp: READ,
  comm: READ,
  join: READ,
  paste: READ,
  column: READ,
  nl: READ,
  fold: READ,
  fmt: READ,
  rev: READ,
  seq: READ,
  basename: READ,
  dirname: READ,
  realpath: READ,
  readlink: READ,
  sleep: READ,
  true: READ,
  false: READ,
  test: READ,
  whoami: READ,
  id: READ,
  uname: READ,
  uptime: READ,
  ps: READ,
  od: READ,
  hexdump: READ,
  md5: READ,
  md5sum: READ,
  shasum: READ,
  sha1sum: READ,
  sha256sum: READ,
  zcat: READ,
  strings: READ,
  eza: READ,
  exa: READ,
  lsd: READ,
  rg: { read: true, runs: flag(RUNS, ["--pre"]) },
  ag: { read: true, runs: flag(RUNS, ["--pager"]) },
  fd: { read: true, runs: flag(RUNS, ["--exec", "--exec-batch"], "xX") },
  sort: { read: true, writes: flag(OUTPUT, ["--output"], "o"), runs: flag(RUNS, ["--compress-program"]) },
  uniq: {
    read: true,
    writes: (args) => (operands(args).length > 1 ? `${operands(args)[1]} is written` : undefined),
  },
  tree: { read: true, writes: flag(OUTPUT, [], "o") },
  file: { read: true, writes: flag("compiles a magic file", ["--compile"], "C") },
  base64: { read: true, writes: flag(OUTPUT, ["--output"], "o") },
  xxd: {
    read: true,
    writes: (args) => (operands(args).length > 1 ? `${operands(args)[1]} is written` : undefined),
  },
  yq: { read: true, writes: flag(IN_PLACE, ["--inplace"], "i") },
  date: { read: true, writes: flag("sets the clock", ["--set"], "s") },
  git: {
    read: true,
    writes: flag(OUTPUT, ["--output"]),
    /**
     * `--ext-diff` runs a diff driver; before the subcommand, `-c core.pager=…`, `--config-env` and
     * `--exec-path` run whatever their value names, whatever the subcommand (as `family.runsAnother`).
     */
    runs: (args) => {
      const globals = args.slice(0, args.length - subcommand(args, TOOL_GLOBALS.git).length)
      const set = globals.find((arg) => /^(-c|--config-env|--exec-path)(=|$)/.test(arg))
      return set !== undefined ? `${set} ${RUNS}` : flag(RUNS, ["--ext-diff"])(args)
    },
    only: (args) => {
      const [sub, ...rest] = subcommand(args, TOOL_GLOBALS.git)
      if (sub !== undefined && GIT_READS.has(sub)) return undefined
      if (sub !== undefined && GIT_SOMETIMES[sub]?.(rest)) return undefined
      return `git ${sub ?? ""} is not a read`.trim()
    },
  },
  sed: { read: true, writes: flag(IN_PLACE, ["--in-place"], "i"), only: (args) => sedPrints(args) },
  /* Not reads — here for what a widening of them must not cover (#44). */
  perl: { writes: flag(IN_PLACE, [], "i") },
  awk: { writes: (args) => inplace(args) },
  gawk: { writes: (args) => inplace(args) },
  tee: {
    writes: (args) => {
      const file = operands(args).find((word) => word !== "/dev/null")
      return file === undefined ? undefined : `${file} is written`
    },
  },
  curl: {
    writes: flag(
      OUTPUT,
      ["--output", "--remote-name", "--remote-name-all", "--dump-header", "--cookie-jar"],
      "oODc",
    ),
  },
  wget: {
    writes: (args) =>
      args.includes("--spider") || args.includes("-O-") || args.includes("-qO-") || stdout(args, "-O")
        ? undefined
        : "downloads to a file",
  },
  find: {
    writes: (args) => args.find((arg) => /^-(delete|fprint0?|fprintf|fls)$/.test(arg)),
    runs: (args) => args.find((arg) => /^-(exec|execdir|ok|okdir)$/.test(arg)),
  },
  tar: {
    writes: (args) => {
      const mode = args.find((arg) => /^-?[A-Za-z]+$/.test(arg) && !arg.startsWith("--"))
      return mode !== undefined && /[xcruA]/.test(mode) ? `${mode} writes an archive or its files` : undefined
    },
  },
  unzip: {
    writes: (args) => (flagsOf(args).some((f) => /^-[ltvpZ]/.test(f)) ? undefined : "extracts files"),
  },
}

/* ─── sed ────────────────────────────────────────────────────────────────────────────────────── */

/** An address: a line, the last line, or a `/regex/`; a range of two, or `N,+M` / `N,~M`. */
const ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/I?)`
const RANGE = String.raw`(?:${ADDRESS}(?:\s*,\s*(?:${ADDRESS}|[+~]\d+))?)`
/**
 * The sed commands that only print: `p`, `d`, `q`, `=`, `n`, `l`, each behind an optional address
 * (`1,50p`, `/^#/d`, `$=`), and `s/a/b/` with flags that print or repeat — never `w` (writes a file),
 * never `e` (runs one). Only `/` as the delimiter; anything else is not read here, so it is not a read.
 */
const SED_COMMAND = new RegExp(
  `^(?:${RANGE}\\s*!?\\s*)?(?:[pdq=nlPDN]|q\\d+|s/(?:[^/\\\\]|\\\\.)*/(?:[^/\\\\]|\\\\.)*/[gpiI0-9]*)$`,
)

/** Flags that say nothing about what the script does: quiet, extended regex, separate files. */
const SED_FLAGS = /^-(?:[nErsuz]+|-quiet|-silent|-regexp-extended|-separate|-unbuffered|-null-data|-posix)$/

/**
 * Why this `sed` is not a print-only one: a flag outside the harmless few (`-i`, `-f file`), or a
 * script command that writes or runs (`w out`, `s/a/b/w out`, `e cmd`), or one too unusual to read.
 */
function sedPrints(args: readonly string[]): string | undefined {
  const scripts: string[] = []
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if (word === "-e" || word === "--expression") {
      const next = args[++i]
      if (next === undefined) return "a sed script is missing"
      scripts.push(next)
    } else if (word.startsWith("--expression=")) scripts.push(word.slice("--expression=".length))
    else if (/^-[nErsuz]*e$/.test(word)) {
      /** `-ne 2p`: the cluster's last letter takes the next word as the script. */
      const next = args[++i]
      if (next === undefined) return "a sed script is missing"
      scripts.push(next)
    } else if (/^-[nErsuz]*e./.test(word)) scripts.push(word.slice(word.indexOf("e") + 1))
    else if (word.startsWith("-") && word !== "-") {
      if (!SED_FLAGS.test(word)) return `sed ${word} is not a plain print`
    } else rest.push(word)
  }
  if (scripts.length === 0) {
    const first = rest.shift()
    if (first === undefined) return "a sed script is missing"
    scripts.push(first)
  }
  for (const script of scripts)
    for (const part of script.split(/[;\n]/)) {
      const command = part.trim()
      if (command !== "" && !SED_COMMAND.test(command)) return "the sed script may write or run something"
    }
  return undefined
}

/** `awk -i inplace`, `--include=inplace`. */
function inplace(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if ((word === "-i" || word === "--include") && args[i + 1] === "inplace") return `-i inplace ${IN_PLACE}`
    if (/^(-i|--include=)inplace$/.test(word)) return `${word} ${IN_PLACE}`
  }
  return undefined
}

/** `-O -`: written to the terminal, not a file. */
const stdout = (args: readonly string[], name: string) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] === "-"
}

/* ─── the questions ──────────────────────────────────────────────────────────────────────────── */

/** The program and its arguments, under any wrappers (`timeout 5 sed -i …` is `sed -i …`). */
function program(
  argv: readonly string[],
): { name: string; args: readonly string[]; wrapped: boolean } | undefined {
  let rest = argv
  let wrapped = false
  for (let depth = 0; depth < 8; depth++) {
    const once = unwrapOnce(rest)
    if (!once) break
    rest = once.rest
    wrapped = true
  }
  const [first, ...args] = rest
  return first === undefined ? undefined : { name: posix.basename(first), args, wrapped }
}

/** Why a flag makes this command write a file — the redirections are `family.redirections`'s. */
export function writesByFlag(argv: readonly string[]): string | undefined {
  const found = program(argv)
  return found && PROGRAMS[found.name]?.writes?.(found.args)
}

/** Why a flag makes this command run another program. */
export function runsByFlag(argv: readonly string[]): string | undefined {
  const found = program(argv)
  return found && PROGRAMS[found.name]?.runs?.(found.args)
}

/**
 * Files whose contents are secrets: reading one is never routine, whatever program does it. A learned
 * `cat` covers `cat README.md`, not `cat .env`.
 */
const SENSITIVE =
  /(^|[/=])(\.env(\.[\w.-]+)?|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)\b[^/]*|[^/]*\.(pem|key|p12|pfx|keystore|jks))$|(^|\/)(\.ssh|\.aws|\.gnupg|\.kube|\.docker)(\/|$)|credentials|secrets?(\.|\/|$)/i

export const sensitive = (word: string): boolean => SENSITIVE.test(word)

/**
 * Why this command is not a plain read, or `undefined` when it is one: a program in the table that
 * only reads, no flag that writes or runs, no redirection that writes (`writes`, from the caller),
 * nothing in front of it (an env var — `LD_PRELOAD` — or a wrapper — `sudo`, `xargs`), nothing
 * dangerous, and no secret file named.
 */
export function notRead(command: Command, writes: readonly string[]): string | undefined {
  if (command.env.length > 0) return "it sets an environment variable"
  const found = program(command.argv)
  if (!found) return "nothing runs"
  if (found.wrapped) return "it runs under a wrapper"
  const known = PROGRAMS[found.name]
  if (!known?.read) return `${found.name} is not a known read`
  if (writes.length > 0) return "it writes to a file"
  const why = known.writes?.(found.args) ?? known.runs?.(found.args) ?? known.only?.(found.args)
  if (why) return why
  const danger = dangerOf(command)
  if (danger) return `dangerous (${danger})`
  const secret = found.args.find(sensitive)
  if (secret) return `${secret} may hold secrets`
  return undefined
}
