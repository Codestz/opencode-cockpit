/**
 * Families: what several exact rules have in common, and how a rule is shown so nothing about it is
 * left to the font.
 *
 * A signature is exact on purpose (signature.ts), so a project that runs `ls -la`, `ls -la src` and
 * `ls -R docs` has three rules — which is right for trust and wrong for reading: a ledger of forty
 * exact lines does not say "you trust ls". A family is the part of a command that names *what it
 * does*: the program, and for a tool with subcommands, the subcommand (`git status`, `docker compose
 * up`, `npm run test`). The ledger groups by it, and it is the one unit a person can widen trust to,
 * on purpose (`w` in the ledger). Trust learns one kind of family by itself — plain reads, and only
 * the reads in it (`notReadSubject`, effect.ts); every other widening is a person's (docs/roadmap/trust.md).
 * It suggests them (suggest.ts); it never makes them.
 *
 * The rules, and why each one leans the way it does:
 *
 * - **The plain words after the program, up to three**: `mcpx db-local execute_sql`, `gh pr view`,
 *   `npm run test`. Reading stops at the first argument — a number, a path, a file, quoted text — so
 *   `cat a.json` and `cat b.json` are one family. No list of tools: any CLI reads the same way.
 * - **So is the target**: a flag that says which one (`--context`, `--profile`, `-p`, `-n`, `--host`…)
 *   with its value, and any word or env var that names an environment (`db-prod`,
 *   `NODE_ENV=production`, a host with `dev` in it). `docker compose -p dev up` and `-p prod up` are
 *   two families: a widening that covered both trusted production along with dev. Flags that say
 *   nothing about the target (`git -C dir`, `-o wide`) are not part of it. Measured against the rule
 *   this replaced (packages/trust/experiments/families): it merged 23 of 32 pairs that must stay
 *   apart; this one merges none.
 * - **A wrapper is part of it**: `sudo ls` is not `ls`, and neither is `timeout 5 ls`. Trusting any
 *   `ls` must not quietly cover running it as root.
 * - **So is where it runs and what it is told**: `(in web) bun test` and `NODE_ENV=… npm run build`
 *   are their own families. A directory or an environment changes what the same words do.
 * - **Too fine is the safe side**: `echo done` and `echo ok` are two families. That costs approvals,
 *   never trust.
 * - **Redirections are not**: `ls > out.txt` groups under `ls` — but a widened family does not cover
 *   it (`outside`), because writing a file is not what "any ls" was agreed to mean.
 *
 * Other permissions: an edit's family is its folder (`src/`), a fetch's its host, an agent type is
 * its own — the last two already are as wide as they go.
 */

import { posix } from "node:path"
import { dangerOf, subcommand, TOOL_GLOBALS, unwrapOnce } from "./danger.ts"
import { GIT_READS, notRead, runsByFlag, sensitive, writesByFlag } from "./effect.ts"
import { envWords } from "./env.ts"
import { canonical } from "./rules.ts"
import { type Command, parse } from "./shell.ts"
import { quote } from "./signature.ts"

/* ─── reading a subject back ─────────────────────────────────────────────────────────────────── */

/** `(in web) ` or `(in 'my dir') `, as `signature()` writes a place. */
const PLACE = /^\(in ('(?:[^']|'\\'')*'|[^\s)]+)\) /

/**
 * A bash subject read back into its command. A signature is written to be parsed again — every word
 * quoted by `quote` — so this is exact; anything that does not read as one command is left alone.
 */
export function readSubject(subject: string): { place?: string; command: Command } | undefined {
  let rest = subject
  let place: string | undefined
  const found = subject.match(PLACE)
  if (found) {
    const read = parse(found[1] as string)
    const word = read.kind === "commands" && read.commands.length === 1 ? read.commands[0]?.argv : undefined
    if (word?.length !== 1) return undefined
    place = word[0]
    rest = subject.slice(found[0].length)
  }
  const read = parse(rest)
  if (read.kind !== "commands" || read.commands.length !== 1) return undefined
  const command = read.commands[0] as Command
  if (command.cwd !== undefined) return undefined
  return place === undefined ? { command } : { place, command }
}

/* ─── redirections ───────────────────────────────────────────────────────────────────────────── */

/** A redirection that takes the next word as its file: `>`, `2>>`, `&>`, `<`. */
const TO_FILE = /^(\d*|&)(>>?|<)$/
/** One that names another descriptor and takes no file: `2>&1`, `>&2`, `<&-`. */
const TO_FD = /^\d*[<>]&[\d-]$/

export const isRedirect = (word: string): boolean => TO_FILE.test(word) || TO_FD.test(word)

/** The words without their redirections, and the files the command writes to. */
function redirections(
  argv: readonly string[],
  ops?: readonly number[],
): { words: string[]; writes: string[] } {
  const words: string[] = []
  const writes: string[] = []
  /** The reader says which words the shell acts on; a quoted `'>'` is an argument (shell.ts). */
  const op = (i: number, word: string) => (ops ? ops.includes(i) : isRedirect(word))
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string
    if (op(i, word) && TO_FD.test(word)) continue
    if (op(i, word) && TO_FILE.test(word)) {
      const target = argv[i + 1]
      if (target !== undefined && word.includes(">") && target !== "/dev/null") writes.push(target)
      i++
      continue
    }
    words.push(word)
  }
  return { words, writes }
}

/* ─── families ───────────────────────────────────────────────────────────────────────────────── */

/** A plain word: a subcommand, a server, a script name. Not a flag, number, path, file or text. */
const NAME = /^[A-Za-z][A-Za-z0-9_:-]*$/
const isFlag = (word: string) => word.startsWith("-") && word !== "-" && word !== "--"

/** The plain words a family keeps at most: `mcpx db-local execute_sql`, `gh pr view`. */
const MAX_NAMES = 3

const namesPlace = (text: string) => envWords(text).some((word) => word !== "test" && word !== "testing")

/**
 * The place a word names, if any: a URL's host, a host or a name (`db-prod`, `api.dev.acme.test`).
 * A file path names no place — `~/.local/share/…` is not the local environment.
 */
function placeOf(word: string): string | undefined {
  const url = /^[a-z]+:\/\/([^/]+)/i.exec(word)
  const place = url ? (url[1] as string) : word.includes("/") ? undefined : word
  return place !== undefined && namesPlace(place) ? place : undefined
}

/** Long flags whose value says which target a command acts on, whatever the tool. */
const TARGET_FLAGS = new Set([
  "context",
  "kube-context",
  "kubeconfig",
  "profile",
  "project",
  "project-name",
  "namespace",
  "host",
  "hostname",
  "server",
  "cluster",
  "region",
  "account",
  "env",
  "environment",
  "stage",
  "target",
  "app",
  "database",
  "db",
  "url",
  "endpoint",
  "workspace",
  "file",
  "config",
  "org",
  "team",
  "site",
  "tenant",
])
/** The short ones most tools give them: -p project, -n namespace, -h host, -a app, -c context, -f file, -e env. */
const TARGET_SHORT = new Set(["p", "n", "h", "a", "c", "f", "e"])

/**
 * Standard utilities, which never take a subcommand: the word after them is an argument (`ls src`,
 * `cat Makefile`, `echo done`), so their family is the program alone, plus any target or environment
 * it names. Their short flags are their own (`grep -c` counts, `ls -a` lists all), never a target. A
 * fixed list of what Unix ships, not of tools: any other CLI is read by the general rule.
 */
const UTILITIES = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "find",
  "fd",
  "echo",
  "printf",
  "pwd",
  "which",
  "whereis",
  "type",
  "file",
  "stat",
  "tree",
  "du",
  "df",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sed",
  "awk",
  "gawk",
  "jq",
  "yq",
  "diff",
  "cmp",
  "less",
  "more",
  "touch",
  "mkdir",
  "cp",
  "mv",
  "ln",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "date",
  "sleep",
  "true",
  "false",
  "test",
  "xxd",
  "od",
  "hexdump",
  "column",
  "nl",
  "tee",
  "comm",
  "join",
  "paste",
  "fold",
  "fmt",
  "rev",
  "seq",
  "yes",
  "whoami",
  "id",
  "uname",
  "hostname",
  "uptime",
  "ps",
  "top",
  "env",
  "printenv",
  "open",
  "pbcopy",
  "pbpaste",
  "base64",
  "md5",
  "md5sum",
  "shasum",
  "sha256sum",
  "zcat",
  "gzip",
  "gunzip",
  "tar",
  "zip",
  "unzip",
  "chmod",
  "chown",
])

/**
 * Flags before a subcommand that take a value and say nothing about the target — `git -C dir`,
 * `npm -w pkg` — stepped over with their value, so the subcommand after them is still read.
 */
const VALUE_GLOBALS: Readonly<Record<string, readonly string[]>> = {
  ...TOOL_GLOBALS,
  npm: ["-w", "--workspace", "--prefix", "-C"],
  pnpm: ["-F", "--filter", "-C", "--dir"],
  yarn: ["--cwd"],
  bun: ["--cwd"],
  make: ["-C", "-f", "--file", "--directory"],
}

/**
 * The flag at `i` when it names a target, with the words it keeps: `--context cluster-a`, `-p dev`,
 * `--env=prod`, `--prod`. A value that starts with a digit is a count or a range (`-n 40`), never a
 * target; a flag that is no target still counts when its value names an environment (`-d prod-db`).
 */
function targetAt(
  args: readonly string[],
  i: number,
  shortTargets: boolean,
): { words: string[]; skip: number } | undefined {
  const word = args[i] as string
  if (!isFlag(word)) return undefined
  const eq = word.indexOf("=")
  const name = (eq > 0 ? word.slice(0, eq) : word).replace(/^-+/, "")
  const value = eq > 0 ? word.slice(eq + 1) : args[i + 1]
  if (namesPlace(name)) return { words: [word], skip: 0 }
  if (eq > 0 && placeOf(value ?? "") !== undefined) return { words: [word], skip: 0 }
  const target = word.startsWith("--")
    ? TARGET_FLAGS.has(name)
    : shortTargets && name.length === 1 && TARGET_SHORT.has(name)
  if (value === undefined || isFlag(value) || /^\d/.test(value)) return undefined
  if (target) return eq > 0 ? { words: [word], skip: 0 } : { words: [word, value], skip: 1 }
  return eq < 0 && placeOf(value) !== undefined ? { words: [word, value], skip: 1 } : undefined
}

/**
 * The family words after the program, read in order: plain words (at most `MAX_NAMES`) and target flags
 * with their values, until the first other flag or argument — `compose -p dev up` from
 * `docker compose -p dev up -d`. Target flags and words naming an environment further on still count:
 * `kubectl get pods -o wide -n prod` is `kubectl get pods -n prod`, `ssh -p 2222 prod-box` keeps
 * `prod-box`, `curl https://api.dev.acme.test/x` keeps the host. A file path never counts.
 */
function walk(args: readonly string[], globals: readonly string[], limit: number): string[] {
  const out: string[] = []
  let names = 0
  let i = 0
  for (; i < args.length; i++) {
    const word = args[i] as string
    const target = targetAt(args, i, limit > 0)
    if (target) {
      out.push(...target.words)
      i += target.skip
      continue
    }
    if (isFlag(word) && globals.includes(word.split("=")[0] as string)) {
      if (!word.includes("=")) i++
      continue
    }
    if (isFlag(word) || !NAME.test(word) || names >= limit) break
    out.push(word)
    names++
  }
  for (; i < args.length; i++) {
    const word = args[i] as string
    const target = targetAt(args, i, limit > 0)
    if (target) {
      if (!out.includes(target.words[0] as string)) out.push(...target.words)
      i += target.skip
      continue
    }
    const place = isFlag(word) ? undefined : placeOf(word)
    if (place !== undefined && !out.includes(place)) out.push(place)
  }
  return out
}

/**
 * The words that name a command's family: its wrappers, its program, and what `walk` keeps. Wrappers
 * are part of it (`sudo ls` is not `ls`); redirections are not (`ls > out.txt` is `ls`, and a
 * widening does not cover it: `outside`).
 */
function familyWords(argv: readonly string[], ops?: readonly number[]): string[] {
  let rest: readonly string[] = redirections(argv, ops).words
  const head: string[] = []
  for (let depth = 0; depth < 8; depth++) {
    const once = unwrapOnce(rest)
    if (!once) break
    head.push(once.wrapper)
    rest = once.rest
  }
  const [program, ...args] = rest
  if (program === undefined) return head
  const name = posix.basename(program)
  return [...head, program, ...walk(args, VALUE_GLOBALS[name] ?? [], namesFor(name, args))]
}

/** `git` subcommands that take one of their own: `git stash list`, `git worktree add`. */
const GIT_NESTED = new Set([
  "stash",
  "worktree",
  "remote",
  "submodule",
  "notes",
  "bisect",
  "lfs",
  "sparse-checkout",
])

/**
 * Plain words a family keeps after the program. A utility's are its input (`cat a.json`): none. After
 * a git subcommand that only looks, they are refs and paths — `git show abc123`, `git merge-base feat
 * origin/main` — so one `git show` is one family, not one per commit. A git subcommand that changes
 * things keeps its words: pushing to `main` and to a feature branch stay two families.
 */
function namesFor(name: string, args: readonly string[]): number {
  if (UTILITIES.has(name)) return 0
  if (name === "git") {
    const sub = subcommand(args, TOOL_GLOBALS.git)[0] ?? ""
    if (GIT_NESTED.has(sub)) return 2
    if (GIT_READS.has(sub)) return 1
  }
  return MAX_NAMES
}

/** `NODE_ENV=…`: the name, not the value — unless the value names an environment (`NODE_ENV=production`). */
const envWord = (word: string) =>
  namesPlace(word.slice(word.indexOf("=") + 1)) ? word : `${word.slice(0, word.indexOf("="))}=…`

function bashFamily(command: Command, place: string | undefined): string {
  const words = [
    ...command.env.map(envWord),
    ...familyWords(command.argv, command.redirects).map(quote),
  ].join(" ")
  return place === undefined ? words : `(in ${quote(place)}) ${words}`
}

/**
 * A subject's family, under its permission. The same string for every command in it, so it is what
 * a widening is recorded against and what the ledger groups by.
 */
export function familyOf(permission: string, subject: string): string {
  const name = canonical(permission)
  if (name === "bash") {
    const read = readSubject(subject)
    return read && read.command.argv.length > 0 ? bashFamily(read.command, read.place) : subject
  }
  if (name === "edit" || name === "read") {
    const folder = posix.dirname(subject)
    return folder === "." ? "./" : folder.endsWith("/") ? folder : `${folder}/`
  }
  /** A search and a web query are new words every time: the tool is the family (`any grep`). */
  if (WHOLE_TOOL.has(name)) return "*"
  return subject
}

/** OpenCode tools whose every request is new text — a glob, a regex, a query — so one family each. */
const WHOLE_TOOL = new Set(["glob", "grep", "websearch"])

/** OpenCode's own tools that only read the project: learned like a command that only reads. */
const READ_TOOLS = new Set(["read", "glob", "grep", "list", "lsp"])

/** The family's own words as a command, for judging the family itself. */
function familyCommand(family: string): Command | undefined {
  return readSubject(family)?.command
}

/**
 * Whether a family may be widened at all. A dangerous family never: if `git push` itself is
 * dangerous, "any git push" is a rule that answers force-pushes — every one of them has to earn
 * trust on its own, at the higher count. A fetch or an agent type is already as wide as it goes.
 */
export function widenable(permission: string, family: string): { ok: true } | { ok: false; why: string } {
  const name = canonical(permission)
  if (name === "bash") {
    const command = familyCommand(family)
    if (!command || command.argv.length === 0) return { ok: false, why: "it cannot be read as one command" }
    const danger = dangerOf(command)
    return danger
      ? {
          ok: false,
          why: `${showSubject("bash", family)} is dangerous${
            danger === showSubject("bash", family) ? "" : ` (${danger})`
          } — each one earns trust on its own`,
        }
      : { ok: true }
  }
  if (name === "edit" || name === "read" || WHOLE_TOOL.has(name)) return { ok: true }
  if (name === "webfetch") return { ok: false, why: "a fetch rule already covers the whole host" }
  if (name === "task") return { ok: false, why: "an agent type is already one rule" }
  return { ok: false, why: `a ${name} rule is already as wide as it goes` }
}

/** Programs that run another program named in their arguments: what runs is not the family. */
function runsAnother(argv: readonly string[]): boolean {
  let rest: readonly string[] = argv
  for (let depth = 0; depth < 8; depth++) {
    const once = unwrapOnce(rest)
    if (!once) break
    rest = once.rest
  }
  const [program, ...args] = rest
  if (program === undefined) return false
  if (runsByFlag(rest)) return true
  const name = posix.basename(program)
  if (name === "find") return args.some((arg) => ["-exec", "-execdir", "-ok", "-okdir"].includes(arg))
  if (name === "git") {
    /** `git -c core.pager=…` and friends run whatever the value says, whatever the subcommand. */
    const globals = args.slice(0, args.length - subcommand(args, TOOL_GLOBALS.git).length)
    return globals.some((arg) => /^(-c|--config-env|--exec-path)(=|$)/.test(arg))
  }
  return false
}

/**
 * Why a widened family would still ask about this subject — or nothing when it covers it. A widening
 * is "any `ls`", not "anything that starts with ls": a dangerous command, one that writes a file
 * through a redirection, and one that hands its arguments to another program each still ask.
 */
export function outside(permission: string, subject: string): string | undefined {
  if (canonical(permission) !== "bash") return undefined
  const read = readSubject(subject)
  if (!read) return "it cannot be read as one command"
  const danger = dangerOf(read.command)
  if (danger) return `dangerous (${danger})`
  if (redirections(read.command.argv, read.command.redirects).writes.length > 0) return "it writes to a file"
  const writes = writesByFlag(read.command.argv)
  if (writes) return `it writes to a file (${writes})`
  if (runsAnother(read.command.argv)) return "it runs another program"
  return undefined
}

/** A widened `family` answers `subject`. */
export const covers = (permission: string, family: string, subject: string): boolean =>
  familyOf(permission, subject) === family && outside(permission, subject) === undefined

/**
 * Why a learned family would still ask about this subject — or nothing when it is a plain read
 * (effect.ts). Narrower than `outside`: a family Trust learned by itself covers reads only, so
 * `head -3 a.txt` is in a learned `head` and `head .env` or `head -3 a > b` are not.
 */
export function notReadSubject(permission: string, subject: string): string | undefined {
  const name = canonical(permission)
  if (READ_TOOLS.has(name))
    return name === "read" && sensitive(subject) ? `${subject} may hold secrets` : undefined
  if (name !== "bash") return `a ${name} is not a read`
  const read = readSubject(subject)
  if (!read) return "it cannot be read as one command"
  return notRead(read.command, redirections(read.command.argv, read.command.redirects).writes)
}

/* ─── showing it ─────────────────────────────────────────────────────────────────────────────── */

/** Words that read as themselves with no quotes, in any shell and any font. */
const BARE = /^[A-Za-z0-9_@%+=:,./~^-]+$/
/**
 * Runs of characters that programming fonts draw as one glyph (Fira Code, JetBrains Mono, Cascadia):
 * `---` became `──` on a user's screen and `echo ---` read as `echo ──`. Quoted, the run is still
 * merged, but the quotes say there is one argument and where it ends.
 */
const LIGATURE = /---|-->|->|<-|=>|==|!=|<=|>=|<>|www|\.\.|::|\/\/|&&|\|\||\*\*|~~|\+\+|##|\/\*|\*\//

/**
 * One word as the ledger shows it: bare when nothing about it can be misread, otherwise in double
 * quotes — easier to read than the signature's single quotes, and this is display, never parsed.
 * A punctuation-only word is always quoted (a lone `-` or `.` aside: one character cannot merge).
 */
export function shown(word: string): string {
  if (word === "") return '""'
  const plain = BARE.test(word) && (/[A-Za-z0-9]/.test(word) || word.length === 1) && !LIGATURE.test(word)
  if (plain) return word
  if ([...word].some(isControl)) return `$'${[...word].map(controlEscape).join("")}'`
  return `"${word.replace(/["\\$`]/g, "\\$&")}"`
}

const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

/** One character inside `$'…'`: a newline is `\n`, a quote or backslash escaped, the rest itself. */
function controlEscape(char: string): string {
  const named: Record<string, string> = { "\n": "\\n", "\t": "\\t", "\r": "\\r", "'": "\\'", "\\": "\\\\" }
  const known = named[char]
  if (known !== undefined) return known
  return isControl(char) ? `\\x${(char.codePointAt(0) ?? 0).toString(16).padStart(2, "0")}` : char
}

/** What each character a font may merge is called, so a run can be said in words. */
const NAMES: Record<string, [string, string]> = {
  "-": ["hyphen", "hyphens"],
  "=": ["equals sign", "equals signs"],
  ">": ["greater-than", "greater-thans"],
  "<": ["less-than", "less-thans"],
  "!": ["exclamation mark", "exclamation marks"],
  ".": ["dot", "dots"],
  ":": ["colon", "colons"],
  "/": ["slash", "slashes"],
  "&": ["ampersand", "ampersands"],
  "|": ["pipe", "pipes"],
  "*": ["asterisk", "asterisks"],
  "~": ["tilde", "tildes"],
  "+": ["plus", "pluses"],
  "#": ["hash", "hashes"],
}

/**
 * The runs of a word a font may draw as one glyph, said in words: `---` is "3 hyphens", `->` is
 * "hyphen, greater-than". Quotes were not enough — inside them `"---"` still drew as `"──"` on the
 * user's screen — so the ledger says it in letters, which no font merges.
 */
export function spelled(word: string): string | undefined {
  const runs = word.match(new RegExp(LIGATURE.source, "g"))
  if (!runs) return undefined
  const said = runs.map((run) => {
    const parts: string[] = []
    for (const group of run.match(/(.)\1*/g) ?? []) {
      const name = NAMES[group[0] as string]
      if (!name) return undefined
      parts.push(group.length === 1 ? name[0] : `${group.length} ${name[1]}`)
    }
    return parts.join(", ")
  })
  if (said.some((each) => each === undefined)) return undefined
  return [...new Set(said)].join("; ")
}

/**
 * Each argument of a subject a font may draw as something else, as the ledger shows it (`"---"`)
 * beside what it is in words (`3 hyphens`). The panel says which word it means: a bare `3 hyphens`
 * after a command read as a riddle (a user's screenshot).
 */
export function spelledWords(permission: string, subject: string): { word: string; said: string }[] {
  if (canonical(permission) !== "bash") return []
  const read = readSubject(subject)
  if (!read) return []
  /** Only words that are punctuation and nothing else: `---` is unreadable, `../src` and URLs are not. */
  const words = read.command.argv.filter(
    (word, i) =>
      !(read.command.redirects ?? []).includes(i) && !isRedirect(word) && /^[^A-Za-z0-9\s]+$/.test(word),
  )
  const out: { word: string; said: string }[] = []
  for (const word of new Set(words)) {
    const said = spelled(word)
    if (said !== undefined) out.push({ word: shown(word), said })
  }
  return out
}

/** The spelled runs of every argument of a subject, for the ledger to put beside it. */
export function spelledSubject(permission: string, subject: string): string | undefined {
  const said = [...new Set(spelledWords(permission, subject).map((each) => each.said))]
  return said.length > 0 ? said.join("; ") : undefined
}

/** A command as the ledger shows it: every argument unambiguous, redirections as redirections. */
export function showCommand(command: Command): string {
  const env = command.env.map((word) => {
    const at = word.indexOf("=")
    const value = word.slice(at + 1)
    return `${word.slice(0, at + 1)}${value === "…" ? value : value === "" ? "" : shown(value)}`
  })
  const argv = command.argv.map((word) => (isRedirect(word) ? word : shown(word)))
  return [...env, ...argv].join(" ")
}

/** A subject — or a family — as the ledger and the sidebar show it. Paths and hosts are themselves. */
export function showSubject(permission: string, subject: string): string {
  if (canonical(permission) !== "bash") return subject
  const read = readSubject(subject)
  if (!read) return subject
  const words = showCommand(read.command)
  return read.place === undefined ? words : `(in ${shown(read.place)}) ${words}`
}

/** `any ls …`, `any file in src/`: what a widened family answers, in words. */
export function anyOf(permission: string, family: string): string {
  const name = canonical(permission)
  if (name === "edit" || name === "read")
    return family === "./" ? "any file at the project's top" : `any file in ${family}`
  if (family === "*") return `any ${name}`
  return `any ${showSubject(name, family)} …`
}

/**
 * A command a little different from `subject`, for the sentence that says what still asks: the
 * command with its last argument dropped, or nothing when it has none past its family.
 */
export function narrower(subject: string): string | undefined {
  const read = readSubject(subject)
  if (!read) return undefined
  const { words } = redirections(read.command.argv, read.command.redirects)
  const family = familyWords(read.command.argv, read.command.redirects)
  if (words.length <= family.length) return undefined
  return showSubject("bash", dropLast(read, words))
}

function dropLast(read: { place?: string; command: Command }, words: readonly string[]): string {
  const command: Command = { env: read.command.env, argv: words.slice(0, -1) }
  const text = [...command.env, ...command.argv].map(quote).join(" ")
  return read.place === undefined ? text : `(in ${quote(read.place)}) ${text}`
}

/** The subject with its output sent to a file: the other thing that still asks. */
export function redirected(subject: string): string | undefined {
  const read = readSubject(subject)
  if (!read || redirections(read.command.argv, read.command.redirects).writes.length > 0) return undefined
  return `${showSubject("bash", subject)} > out.txt`
}
