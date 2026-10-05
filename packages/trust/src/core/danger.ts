/**
 * Which commands cost more trust.
 *
 * Nothing here blocks anything. A dangerous command still earns trust like any other; it needs the
 * normal threshold *plus* `dangerExtra` approvals in a row (docs/roadmap/trust.md, "Decided"). So a
 * miss in this list is never a hole — the command still had to be approved `threshold` times — it is
 * only a command that became automatic sooner than it should have. A false alarm costs a few more
 * approvals and nothing else, which is why every doubt below is settled towards "dangerous".
 *
 * It sees one command at a time: `git add -A && git push --force` arrives as two, and only the second
 * is dangerous. `cwd` is already part of the signature; this is about what the words do.
 *
 * The answer is a reason rather than a yes, because the ledger shows it: "git push" says why a rule
 * needs eight approvals where `true` would leave the person guessing.
 */

import { posix } from "node:path"
import type { Command } from "./shell.ts"

/* ─── the tables ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Programs that destroy, stop or rewrite whatever they are pointed at, whatever their arguments.
 * `truncate` empties files; `shred` and `srm` exist to make data unrecoverable.
 */
const ALWAYS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "srm",
  "dd",
  "fdisk",
  "sfdisk",
  "parted",
  "wipefs",
  "kill",
  "killall",
  "pkill",
  "truncate",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
])

/** `mkfs`, `mkfs.ext4`, `mkfs.vfat`…: every variant formats a disk. */
const ALWAYS_PREFIX = ["mkfs"]

/** Permission and ownership changes are only dangerous when they reach a whole tree. */
const RECURSIVE_ONLY = new Set(["chmod", "chown", "chgrp"])

/**
 * Flags that are dangerous on any program. Only long forms: `-f` means *file* to `tail -f`,
 * `docker compose -f` and `grep -f`, so a short `-f` is judged per program below, never globally.
 */
const FLAGS = new Set(["--force", "--force-with-lease", "--force-if-includes", "--no-preserve-root"])

/**
 * Wrappers run the command after them, so the wrapped command is the one judged. Each lists the
 * flags that take a separate value, so `timeout -s KILL 5 rm x` finds `rm` rather than `KILL`.
 * `sudo` and `doas` are dangerous in themselves: whatever runs, runs as root.
 */
export interface Wrapper {
  /** Flags whose value is the next word. */
  values?: readonly string[]
  /** Positional words the wrapper takes before the command: `timeout 5`, `nice` has none. */
  positionals?: number
  /** Running as someone else is dangerous whatever the command is. */
  dangerous?: string
}

export const WRAPPERS: Readonly<Record<string, Wrapper>> = {
  sudo: { values: ["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T"], dangerous: "sudo" },
  doas: { values: ["-u", "-C"], dangerous: "doas" },
  env: { values: ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"] },
  time: { values: ["-o", "-f", "--output", "--format"] },
  nohup: {},
  timeout: { values: ["-s", "-k", "--signal", "--kill-after"], positionals: 1 },
  nice: { values: ["-n", "--adjustment"] },
  ionice: { values: ["-c", "-n", "-p", "--class", "--classdata"] },
  stdbuf: { values: ["-i", "-o", "-e"] },
  command: {},
  builtin: {},
  xargs: {
    values: ["-I", "-i", "-n", "-P", "-L", "-l", "-d", "-E", "-e", "-s", "-a", "--max-args", "--max-procs"],
  },
}

/**
 * Programs with subcommands. `globals` are the flags before the subcommand that take a separate
 * value — without them `docker compose -p prod down -v` would read `prod` as the subcommand.
 * `judge` sees the subcommand words and everything after them.
 */
interface Tool {
  globals?: readonly string[]
  judge: (words: readonly string[], all: readonly string[]) => string | undefined
}

const has = (args: readonly string[], ...flags: string[]) =>
  args.some(
    (arg) => flags.includes(arg) || flags.some((flag) => flag.startsWith("--") && arg.startsWith(`${flag}=`)),
  )

/** A short flag inside a cluster: `-fd` has `-f`. Only for programs where the letter is known. */
const short = (args: readonly string[], letter: string) =>
  args.some((arg) => /^-[A-Za-z]+$/.test(arg) && arg.includes(letter))

const recursive = (args: readonly string[]) => has(args, "--recursive") || short(args, "R")

const GIT_GLOBALS = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]
const DOCKER_GLOBALS = ["-H", "--host", "-c", "--context", "--config", "-l", "--log-level"]
export const COMPOSE_GLOBALS = [
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--profile",
  "--env-file",
  "--project-directory",
  "--ansi",
  "--progress",
  "--parallel",
]
const KUBE_GLOBALS = [
  "-n",
  "--namespace",
  "--context",
  "--cluster",
  "--kubeconfig",
  "-s",
  "--server",
  "--user",
  "--token",
]

/** Container engines share one vocabulary; `podman` and `nerdctl` copied Docker's. */
function container(words: readonly string[]): string | undefined {
  const [sub, next] = words
  if (sub === "compose") {
    const [action, ...after] = subcommand(words.slice(1), COMPOSE_GLOBALS)
    if (action === "down" && (has(after, "--volumes", "--rmi") || short(after, "v"))) return "compose down -v"
    if (action === "rm") return "compose rm"
    return undefined
  }
  if (sub === "rm" || sub === "rmi" || sub === "kill") return sub
  // `docker container rm`, `docker volume prune`, `docker image rm`…: the object, then what to do.
  if (next === "prune" || next === "rm" || next === "kill") return `${sub} ${next}`
  if (sub === "system" && next === "reset") return "system reset"
  return undefined
}

/** SQL that throws data away, wherever it appears in a client's arguments. */
const DESTRUCTIVE_SQL = /\b(drop|truncate)\b|\bdelete\s+from\b|\balter\s+table\b[^;]*\bdrop\b/i
function sql(_words: readonly string[], all: readonly string[]): string | undefined {
  const found = all.join(" ").match(DESTRUCTIVE_SQL)
  return found ? (found[0].toLowerCase().split(/\s+/)[0] as string) : undefined
}

const publish = (words: readonly string[]): string | undefined => {
  const [sub] = words
  return sub === "publish" || sub === "unpublish" || sub === "deprecate" ? sub : undefined
}

const TOOLS: Record<string, Tool> = {
  git: {
    globals: GIT_GLOBALS,
    judge([sub, ...args]) {
      switch (sub) {
        case "push":
          return "git push"
        case "clean":
          return "git clean"
        case "reset":
          return has(args, "--hard", "--merge", "--keep") ? "git reset --hard" : undefined
        case "checkout":
          // `git checkout -- a.ts` and `git checkout .` throw away work in the tree; `-f` too.
          return args.includes("--") || args.includes(".") || short(args, "f")
            ? "git checkout over files"
            : undefined
        case "switch":
          return has(args, "--discard-changes") || short(args, "f") ? "git switch -f" : undefined
        case "restore": {
          // Unstaging touches nothing on disk; anything that writes the working tree does.
          const staged = has(args, "--staged") || short(args, "S")
          const tree = has(args, "--worktree") || short(args, "W")
          return staged && !tree ? undefined : "git restore"
        }
        case "branch":
          return short(args, "D") || (has(args, "--delete", "-d") && has(args, "--force"))
            ? "git branch -D"
            : undefined
        case "stash":
          return args[0] === "drop" || args[0] === "clear" ? `git stash ${args[0]}` : undefined
        case "rebase":
        case "filter-branch":
        case "filter-repo":
          return `git ${sub}`
        case "update-ref":
          return short(args, "d") ? "git update-ref -d" : undefined
        case "reflog":
          return args[0] === "expire" || args[0] === "delete" ? `git reflog ${args[0]}` : undefined
        case "tag":
          return short(args, "d") || has(args, "--delete") ? "git tag -d" : undefined
        default:
          return undefined
      }
    },
  },
  docker: { globals: DOCKER_GLOBALS, judge: container },
  podman: { globals: DOCKER_GLOBALS, judge: container },
  nerdctl: { globals: DOCKER_GLOBALS, judge: container },
  "docker-compose": {
    globals: COMPOSE_GLOBALS,
    judge: ([sub, ...args]) =>
      sub === "down" && (has(args, "--volumes", "--rmi") || short(args, "v"))
        ? "compose down -v"
        : sub === "rm"
          ? "compose rm"
          : undefined,
  },
  kubectl: {
    globals: KUBE_GLOBALS,
    judge: ([sub, ...args]) =>
      sub === "delete" || sub === "drain"
        ? `kubectl ${sub}`
        : sub === "replace" && has(args, "--force")
          ? "kubectl replace --force"
          : undefined,
  },
  helm: {
    globals: ["-n", "--namespace", "--kube-context", "--kubeconfig"],
    judge: ([sub]) =>
      sub === "uninstall" || sub === "delete" || sub === "rollback" ? `helm ${sub}` : undefined,
  },
  terraform: {
    globals: [],
    judge: ([sub, next]) =>
      sub === "destroy" || sub === "apply" || sub === "import"
        ? `terraform ${sub}`
        : sub === "state" && (next === "rm" || next === "mv" || next === "push")
          ? `terraform state ${next}`
          : undefined,
  },
  psql: { judge: sql },
  mysql: { judge: sql },
  mariadb: { judge: sql },
  sqlite3: { judge: sql },
  "clickhouse-client": { judge: sql },
  "redis-cli": {
    judge: (_words, all) => {
      const found = all.find((word) => /^(flushall|flushdb)$/i.test(word))
      return found ? found.toLowerCase() : undefined
    },
  },
  npm: { judge: publish },
  pnpm: { judge: publish },
  bun: { judge: publish },
  yarn: { judge: (words) => publish(words[0] === "npm" ? words.slice(1) : words) },
  cargo: { judge: ([sub]) => (sub === "publish" ? "cargo publish" : undefined) },
  gem: { judge: ([sub]) => (sub === "push" || sub === "yank" ? `gem ${sub}` : undefined) },
  twine: { judge: ([sub]) => (sub === "upload" ? "twine upload" : undefined) },
  gh: {
    globals: ["-R", "--repo"],
    // `gh repo delete`, `gh release delete`, `gh secret delete`…: whatever it is, it goes.
    judge: (words) => (words.includes("delete") ? "gh … delete" : undefined),
  },
  aws: {
    globals: ["--profile", "--region", "--endpoint-url", "--output"],
    judge: ([service, action]) =>
      service === "s3" && (action === "rm" || action === "rb")
        ? `aws s3 ${action}`
        : action && /^(delete|terminate|remove|purge)-/.test(action)
          ? `aws ${action}`
          : undefined,
  },
  gcloud: { judge: (words) => (words.includes("delete") ? "gcloud … delete" : undefined) },
  systemctl: {
    judge: ([sub]) =>
      sub === "stop" || sub === "disable" || sub === "mask" || sub === "kill"
        ? `systemctl ${sub}`
        : undefined,
  },
  launchctl: {
    judge: ([sub]) =>
      sub === "unload" || sub === "remove" || sub === "bootout" ? `launchctl ${sub}` : undefined,
  },
  crontab: { judge: (_words, all) => (short(all, "r") ? "crontab -r" : undefined) },
  rsync: {
    judge: (_words, all) => (all.some((arg) => arg.startsWith("--delete")) ? "rsync --delete" : undefined),
  },
}

/**
 * The flags before a tool's subcommand that take a separate value, by program: what family.ts needs
 * to find `status` in `git -C /x status`. Read from the table above so the two cannot disagree.
 */
export const TOOL_GLOBALS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(TOOLS).map(([name, tool]) => [name, tool.globals ?? []]),
)

/* ─── reading a command ──────────────────────────────────────────────────────────────────────── */

/** The words after the global flags: `[-C, /tmp, push, origin]` → `[push, origin]`. */
export function subcommand(args: readonly string[], globals: readonly string[] = []): string[] {
  let i = 0
  while (i < args.length) {
    const arg = args[i] as string
    if (arg === "--") return args.slice(i + 1)
    if (!arg.startsWith("-") || arg === "-") break
    i += globals.includes(arg) ? 2 : 1
  }
  return args.slice(i)
}

/**
 * One wrapper taken off the front: its name, and the words it runs. Undefined when `argv` does not
 * start with a wrapper. Families (family.ts) keep the wrapper's name — `sudo ls` is not `ls` — and
 * drop its flags, so this is shared rather than copied.
 */
export function unwrapOnce(
  argv: readonly string[],
): { wrapper: string; rest: readonly string[] } | undefined {
  const program = argv[0]
  if (program === undefined) return undefined
  const name = posix.basename(program)
  const wrapper = WRAPPERS[name]
  if (!wrapper) return undefined
  let i = 1
  while (i < argv.length) {
    const word = argv[i] as string
    if (word === "--") {
      i++
      break
    }
    // `env NAME=value cmd`: assignments are the wrapper's, not the command.
    if (name === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      i++
      continue
    }
    if (!word.startsWith("-")) break
    i += wrapper.values?.includes(word) ? 2 : 1
  }
  return { wrapper: name, rest: argv.slice(i + (wrapper.positionals ?? 0)) }
}

/** The command a wrapper runs, and whether the wrapper itself already made it dangerous. */
function unwrap(argv: readonly string[]): { argv: readonly string[]; reason?: string } {
  let words = argv
  let reason: string | undefined
  for (let depth = 0; depth < 8; depth++) {
    const once = unwrapOnce(words)
    if (!once) break
    reason ??= WRAPPERS[once.wrapper]?.dangerous
    words = once.rest
  }
  return reason ? { argv: words, reason } : { argv: words }
}

/** `find … -delete`, or `-exec rm {} ;` judged by the program it runs. */
function find(args: readonly string[]): string | undefined {
  if (args.includes("-delete")) return "find -delete"
  for (let i = 0; i < args.length; i++) {
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(args[i] as string)) continue
    const end = args.findIndex((word, at) => at > i && (word === ";" || word === "+"))
    const inner = args.slice(i + 1, end < 0 ? undefined : end)
    const reason = judge(inner)
    if (reason) return `find -exec ${reason}`
  }
  return undefined
}

function judge(argv: readonly string[]): string | undefined {
  const unwrapped = unwrap(argv)
  const [program, ...args] = unwrapped.argv
  if (program === undefined) return unwrapped.reason
  const name = posix.basename(program)

  const reason = ((): string | undefined => {
    if (ALWAYS.has(name) || ALWAYS_PREFIX.some((prefix) => name === prefix || name.startsWith(`${prefix}.`)))
      return name
    if (RECURSIVE_ONLY.has(name)) return recursive(args) ? `${name} -R` : undefined
    if (name === "find") return find(args)
    const tool = TOOLS[name]
    return tool ? tool.judge(subcommand(args, tool.globals), args) : undefined
  })()
  if (reason) return unwrapped.reason ? `${unwrapped.reason} ${reason}` : reason

  const flag = args.find((arg) => FLAGS.has(arg.split("=")[0] as string))
  if (flag) return unwrapped.reason ? `${unwrapped.reason} ${flag}` : (flag.split("=")[0] as string)
  return unwrapped.reason
}

/**
 * Words that name production, as a whole word or a part of one (`db-prod`, `prod-eu`,
 * `NODE_ENV=production`). Production costs more trust whatever the command does there, and its
 * family is never widened: "trust any mcpx db-prod execute_sql" is not a rule anyone means to make.
 */
const PRODUCTION = new Set(["prod", "production", "prd", "live"])
const namesProduction = (word: string) =>
  word
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((part) => PRODUCTION.has(part))

/**
 * SQL that writes, in any program's argument — an MCP tool's `--sql`, a client's `-c`, a quoted
 * statement. Read only in an argument of more than one word, so a subcommand called `drop` or a
 * commit message that says "update readme" is not read as SQL; `update … set` has to say `set`.
 */
const WRITE_SQL =
  /^\s*(?:(drop|truncate)\s+(?:table|database|schema|index|view)\b|(delete)\s+from\b|(update)\s+\S+\s+set\b|(insert)\s+into\b|(alter)\s+table\b|(create)\s+(?:table|database|schema|index|view)\b|(grant)\s+\S+.*\bon\b)/i
function writesSql(argv: readonly string[]): string | undefined {
  for (const word of argv) {
    if (!/\s/.test(word)) continue
    for (const statement of word.split(";")) {
      const found = WRITE_SQL.exec(statement)
      if (found)
        return `sql ${found
          .slice(1)
          .find((part) => part !== undefined)
          ?.toLowerCase()}`
    }
  }
  return undefined
}

/** Why a command costs more trust, in a few words — or nothing when it costs the usual. */
export function dangerOf(command: Command): string | undefined {
  const found = judge(command.argv) ?? writesSql(command.argv)
  if (found) return found
  if (command.env.some((word) => namesProduction(word.slice(word.indexOf("=") + 1)))) return "production"
  return command.argv.slice(1).some(namesProduction) ? "production" : undefined
}

export function dangerous(command: Command): boolean {
  return dangerOf(command) !== undefined
}
