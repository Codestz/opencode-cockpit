/**
 * Families: what several exact rules have in common, and how a rule is shown so nothing about it is
 * left to the font.
 *
 * A signature is exact on purpose (signature.ts), so a project that runs `ls -la`, `ls -la src` and
 * `ls -R docs` has three rules — which is right for trust and wrong for reading: a ledger of forty
 * exact lines does not say "you trust ls". A family is the part of a command that names *what it
 * does*: the program, and for a tool with subcommands, the subcommand (`git status`, `docker compose
 * up`, `npm run test`). The ledger groups by it, and it is the one unit a person can widen trust to,
 * on purpose (`w` in the ledger) — never Trust by itself (docs/roadmap/trust.md).
 *
 * The rules, and why each one leans the way it does:
 *
 * - **Global flags are not part of the family**: `git -C /x status` is `git status`, and
 *   `docker compose -p prod down -v` is `docker compose down` — the flags change *where*, the
 *   subcommand says *what*. Read with danger.ts's own tables, so the two never disagree on where the
 *   subcommand is.
 * - **A wrapper is part of it**: `sudo ls` is not `ls`, and neither is `timeout 5 ls`. Trusting any
 *   `ls` must not quietly cover running it as root.
 * - **So is where it runs and what it is told**: `(in web) bun test` and `NODE_ENV=… npm run build`
 *   are their own families. A directory or an environment changes what the same words do.
 * - **Redirections are not**: `ls > out.txt` groups under `ls` — but a widened family does not cover
 *   it (`outside`), because writing a file is not what "any ls" was agreed to mean.
 *
 * Other permissions: an edit's family is its folder (`src/`), a fetch's its host, an agent type is
 * its own — the last two already are as wide as they go.
 */

import { posix } from "node:path"
import { COMPOSE_GLOBALS, dangerOf, subcommand, TOOL_GLOBALS, unwrapOnce } from "./danger.ts"
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

/** Leading words that are not flags, at most `count` of them. */
function lead(words: readonly string[], count: number): string[] {
  const out: string[] = []
  for (const word of words) {
    if (out.length >= count || word.startsWith("-")) break
    out.push(word)
  }
  return out
}

/** One subcommand word, or two after the ones listed: `git stash drop`, `npm run test`. */
const pairs =
  (...two: string[]) =>
  (words: readonly string[]) =>
    lead(words, two.includes(words[0] ?? "") ? 2 : 1)
const one = (words: readonly string[]) => lead(words, 1)
const two = (words: readonly string[]) => lead(words, 2)

/** Docker's management commands: `docker container rm` is about containers, then what to do. */
const OBJECTS = new Set([
  "builder",
  "buildx",
  "config",
  "container",
  "context",
  "image",
  "manifest",
  "network",
  "node",
  "plugin",
  "secret",
  "service",
  "stack",
  "swarm",
  "system",
  "trust",
  "volume",
])

function container(words: readonly string[]): string[] {
  if (words[0] === "compose") return ["compose", ...one(subcommand(words.slice(1), COMPOSE_GLOBALS))]
  return lead(words, OBJECTS.has(words[0] ?? "") ? 2 : 1)
}

interface Tool {
  /** Flags before the subcommand that take a value, besides danger.ts's own. */
  globals?: readonly string[]
  /** The subcommand words that belong to the family, from the words after the globals. */
  take: (words: readonly string[]) => string[]
}

/**
 * Programs with subcommands. Anything not here is its program alone: `ls`, `echo`, `cat`. A package
 * manager's `run` keeps the script, because `npm run test` and `npm run deploy` are not one thing.
 */
const TOOLS: Record<string, Tool> = {
  git: {
    take: pairs("stash", "remote", "submodule", "worktree", "notes", "bisect", "lfs", "sparse-checkout"),
  },
  docker: { take: container },
  podman: { take: container },
  nerdctl: { take: container },
  "docker-compose": { take: one },
  kubectl: { take: pairs("rollout", "config", "auth", "certificate", "set") },
  helm: { take: pairs("repo", "plugin") },
  gh: { take: two },
  aws: { take: two },
  gcloud: { take: two },
  terraform: { take: pairs("state", "workspace") },
  tofu: { take: pairs("state", "workspace") },
  npm: { globals: ["-w", "--workspace", "--prefix", "-C"], take: pairs("run", "run-script", "exec") },
  pnpm: { globals: ["-F", "--filter", "-C", "--dir"], take: pairs("run", "exec", "dlx") },
  yarn: {
    globals: ["--cwd"],
    take: (words) =>
      lead(words, words[0] === "workspace" ? 3 : ["run", "exec", "dlx"].includes(words[0] ?? "") ? 2 : 1),
  },
  bun: { globals: ["--cwd"], take: pairs("run", "x", "pm", "create") },
  deno: { take: pairs("task") },
  npx: { take: one },
  bunx: { take: one },
  pnpx: { take: one },
  cargo: { take: one },
  go: { take: pairs("mod", "work", "tool") },
  pip: { take: one },
  pip3: { take: one },
  uv: { take: pairs("pip", "tool", "python") },
  brew: { take: one },
  systemctl: { take: one },
  launchctl: { take: one },
  make: { globals: ["-C", "-f", "--file", "--directory"], take: one },
}

/** The words that name a command's family, wrappers included, environment and redirections not. */
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
  const tool = TOOLS[name]
  if (!tool) return [...head, program]
  const globals = [...(TOOL_GLOBALS[name] ?? []), ...(tool.globals ?? [])]
  return [...head, program, ...tool.take(subcommand(args, globals))]
}

/** `NODE_ENV=prod` as a family says it: the name, not the value. */
const envName = (word: string) => `${word.slice(0, word.indexOf("="))}=…`

function bashFamily(command: Command, place: string | undefined): string {
  const words = [
    ...command.env.map(envName),
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
  if (name === "edit") {
    const folder = posix.dirname(subject)
    return folder === "." ? "./" : folder.endsWith("/") ? folder : `${folder}/`
  }
  return subject
}

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
    const danger = dangerOf({ env: [], argv: command.argv })
    return danger
      ? {
          ok: false,
          why: `${showSubject("bash", family)} is dangerous${
            danger === showSubject("bash", family) ? "" : ` (${danger})`
          } — each one earns trust on its own`,
        }
      : { ok: true }
  }
  if (name === "edit") return { ok: true }
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
  if (runsAnother(read.command.argv)) return "it runs another program"
  return undefined
}

/** A widened `family` answers `subject`. */
export const covers = (permission: string, family: string, subject: string): boolean =>
  familyOf(permission, subject) === family && outside(permission, subject) === undefined

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
  if (name === "edit") return family === "./" ? "any file at the project's top" : `any file in ${family}`
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
