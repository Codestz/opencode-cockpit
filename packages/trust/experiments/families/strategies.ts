/**
 * Candidate rules for where a command's family ends. Each takes a parsed command (and, for the rule
 * that learns, what has been seen before) and returns its family as text. Two commands with the same
 * text are one family: widening one widens both.
 */

import { posix } from "node:path"
import { unwrapOnce } from "../../src/core/danger.ts"
import { familyOf } from "../../src/core/family.ts"
import type { Command } from "../../src/core/shell.ts"
import { signature } from "../../src/core/signature.ts"

/** What a learning rule has seen: per program, per position, how often each word stood there. */
export type History = Map<string, Map<number, Map<string, number>>>

export interface Strategy {
  id: string
  name: string
  describe: string
  family: (command: Command, history: History) => string
}

/** A plain word: a subcommand, a server, a script name. Not a flag, number, path, file or text. */
const NAME = /^[A-Za-z][A-Za-z0-9_:-]*$/
export const isName = (word: string) => NAME.test(word)
const isFlag = (word: string) => word.startsWith("-") && word !== "-" && word !== "--"

/** Words that name an environment, as a whole word or a part of one: `db-prod`, `acme-staging`. */
const ENV = new Set([
  "prod",
  "production",
  "prd",
  "live",
  "staging",
  "stage",
  "stg",
  "preprod",
  "dev",
  "develop",
  "development",
  "local",
  "localhost",
  "qa",
  "uat",
  "test",
  "testing",
  "sandbox",
])
export const envWords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => ENV.has(word))

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
/** Short ones, as most tools use them: -p project, -n namespace, -h host, -a app, -c context, -f file, -e env. */
const TARGET_SHORT = new Set(["p", "n", "h", "a", "c", "f", "e"])

/** Wrappers (`sudo`, `timeout 5`) kept by name, env vars by name, then the program and its words. */
function split(command: Command): { lead: string[]; program?: string; args: string[] } {
  const lead: string[] = command.env.map((word) => `${word.slice(0, word.indexOf("="))}=…`)
  let rest: readonly string[] = command.argv
  for (let depth = 0; depth < 8; depth++) {
    const once = unwrapOnce(rest)
    if (!once) break
    lead.push(once.wrapper)
    rest = once.rest
  }
  const [program, ...args] = rest
  return program === undefined ? { lead, args: [] } : { lead, program: posix.basename(program), args }
}

/** The leading plain words after the program, up to `cap`; stops at the first that is not one. */
function leading(args: readonly string[], cap: number): string[] {
  const out: string[] = []
  for (const word of args) {
    if (out.length >= cap || !isName(word)) break
    out.push(word)
  }
  return out
}

/** Plain words anywhere after the program, flags stepped over, up to `cap`. */
function names(args: readonly string[], cap: number): string[] {
  const out: string[] = []
  for (const word of args) {
    if (out.length >= cap) break
    if (isFlag(word)) continue
    if (!isName(word)) break
    out.push(word)
  }
  return out
}

/**
 * Flags that name an environment, wherever they are: `--env=prod`, `-p prod`, `--context prod-eu`,
 * `--prod`. A flag's value is the word after it only when that word names an environment, so `-d web`
 * is never read as `-d`'s value.
 */
function envFlags(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if (!isFlag(word)) continue
    const eq = word.indexOf("=")
    if (eq > 0) {
      if (envWords(word.slice(eq + 1)).length > 0) out.push(word)
      continue
    }
    if (envWords(word.replace(/^-+/, "")).length > 0) {
      out.push(word)
      continue
    }
    const next = args[i + 1]
    if (next !== undefined && !isFlag(next) && envWords(next).length > 0) {
      out.push(word, next)
      i++
    }
  }
  return out
}

/** Env vars whose value names an environment, whole: `NODE_ENV=production`. */
const envVars = (command: Command) =>
  command.env.filter((word) => envWords(word.slice(word.indexOf("=") + 1)).length > 0)

/**
 * Any other word that names an environment: a host, a URL, a file (`db.prod.internal`, `api.dev…`).
 * A URL counts by its host — `/health` and `/version` on one host are one family — and `test` does not
 * count here, where it is mostly a file name (`a.test.ts`), not a place.
 */
const envArgs = (args: readonly string[]) =>
  args.flatMap((word) => {
    if (isFlag(word) || isName(word)) return []
    const url = /^[a-z]+:\/\/([^/]+)/i.exec(word)
    const part = url ? (url[1] as string) : word
    return envWords(part).some((env) => env !== "test" && env !== "testing") ? [url ? part : word] : []
  })

const join = (...parts: (string | undefined)[][]) =>
  parts
    .flat()
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ")

/** Positions a learning rule treats as part of the family: a word seen more than once there, or a position with few values. */
function learned(program: string, args: readonly string[], history: History, cap: number): string[] {
  const positions = history.get(program)
  const out: string[] = []
  for (const word of args) {
    if (out.length >= cap || isFlag(word) || !isName(word)) break
    const seen = positions?.get(out.length)
    const distinct = seen?.size ?? 0
    const count = seen?.get(word) ?? 0
    if (count >= 2 || (distinct > 0 && distinct <= 4)) out.push(word)
    else break
  }
  return out
}

/** Every program's leading plain words, by position, counted over `commands`. */
export function historyOf(commands: readonly Command[]): History {
  const history: History = new Map()
  for (const command of commands) {
    const { program, args } = split(command)
    if (!program) continue
    const positions = history.get(program) ?? new Map<number, Map<string, number>>()
    history.set(program, positions)
    leading(args, 3).forEach((word, at) => {
      const words = positions.get(at) ?? new Map<string, number>()
      positions.set(at, words)
      words.set(word, (words.get(word) ?? 0) + 1)
    })
  }
  return history
}

/** The value of every flag whose name means a target, when the value is not a number: `--context cluster-a`, `-p shop`. */
function targetFlags(args: readonly string[]): string[] {
  const valued: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    if (!isFlag(word)) continue
    const eq = word.indexOf("=")
    const flag = (eq > 0 ? word.slice(0, eq) : word).replace(/^-+/, "")
    const value = eq > 0 ? word.slice(eq + 1) : args[i + 1]
    const long = word.startsWith("--")
    const target = long ? TARGET_FLAGS.has(flag) : flag.length === 1 && TARGET_SHORT.has(flag)
    /** A value that starts with a digit is a count or a range (`-n 40`, `-n 1,40p`), never a target. */
    if (!target || value === undefined || isFlag(value) || /^\d/.test(value)) continue
    if (eq > 0) valued.push(word)
    else {
      valued.push(word, value)
      i++
    }
  }
  return valued
}

/** Whether `word` is a flag that names a target, and the value it carries (inline or the next word). */
function targetAt(args: readonly string[], i: number): { words: string[]; skip: number } | undefined {
  const word = args[i] as string
  if (!isFlag(word)) return undefined
  const eq = word.indexOf("=")
  const flag = (eq > 0 ? word.slice(0, eq) : word).replace(/^-+/, "")
  const value = eq > 0 ? word.slice(eq + 1) : args[i + 1]
  const target = word.startsWith("--") ? TARGET_FLAGS.has(flag) : flag.length === 1 && TARGET_SHORT.has(flag)
  const named = envWords(eq > 0 ? word.slice(eq + 1) : "").length > 0 || envWords(flag).length > 0
  if (named && eq > 0) return { words: [word], skip: 0 }
  if (named && eq < 0 && envWords(flag).length > 0) return { words: [word], skip: 0 }
  /** A value that starts with a digit is a count or a range (`-n 40`, `-n 1,40p`), never a target. */
  if (!target || value === undefined || isFlag(value) || /^\d/.test(value)) {
    const next = args[i + 1]
    return eq < 0 && next !== undefined && !isFlag(next) && envWords(next).length > 0
      ? { words: [word, next], skip: 1 }
      : undefined
  }
  return eq > 0 ? { words: [word], skip: 0 } : { words: [word, value], skip: 1 }
}

/**
 * The command read in order: plain words (at most 3) and target flags with their values, until the
 * first other flag or argument. `docker compose -p dev up -d` → `compose -p dev up`.
 */
function walk(args: readonly string[]): string[] {
  const out: string[] = []
  let names = 0
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string
    const target = targetAt(args, i)
    if (target) {
      out.push(...target.words)
      i += target.skip
      continue
    }
    if (isFlag(word) || !isName(word) || names >= 3) break
    out.push(word)
    names++
  }
  /** Target flags further on still count: `kubectl get pods -o wide -n prod`. */
  for (let i = out.length; i < args.length; i++) {
    const target = targetAt(args, i)
    if (target && !out.includes(target.words[0] as string)) {
      out.push(...target.words)
      i += target.skip
    }
  }
  return out
}

export const STRATEGIES: readonly Strategy[] = [
  {
    id: "A",
    name: "Today",
    describe: "The built-in table of tools with subcommands; anything else is its program alone.",
    family: (command) => familyOf("bash", signature(command)),
  },
  {
    id: "B",
    name: "Leading names",
    describe:
      "The program and the plain words right after it, up to 3, stopping at the first flag, number, path, file or text.",
    family: (command) => {
      const { lead, program, args } = split(command)
      return join(lead, [program], leading(args, 3))
    },
  },
  {
    id: "B2",
    name: "Names, flags skipped",
    describe: "As B, but stepping over flags: `compose -p prod up` keeps compose, prod and up.",
    family: (command) => {
      const { lead, program, args } = split(command)
      return join(lead, [program], names(args, 3))
    },
  },
  {
    id: "C",
    name: "Leading names + environment flags",
    describe:
      "B, plus any flag (or env var) whose value names an environment: `-p prod`, `--context prod-eu`, `NODE_ENV=production`.",
    family: (command) => {
      const { lead, program, args } = split(command)
      return join(envVars(command), lead, [program], envFlags(args), leading(args, 3))
    },
  },
  {
    id: "C2",
    name: "C + environment anywhere",
    describe: "C, plus any argument that names an environment: a host or URL with `prod`/`dev` in it.",
    family: (command) => {
      const { lead, program, args } = split(command)
      return join(envVars(command), lead, [program], envFlags(args), envArgs(args), leading(args, 3))
    },
  },
  {
    id: "F",
    name: "C2 + every flag value that is a name",
    describe:
      "C2, plus the word after any flag when it is a plain name (`--context cluster-a`, `-p shop`): no environment word needed.",
    family: (command) => {
      const { lead, program, args } = split(command)
      const valued: string[] = []
      for (let i = 0; i < args.length; i++) {
        const word = args[i] as string
        const next = args[i + 1]
        if (
          isFlag(word) &&
          !word.includes("=") &&
          next !== undefined &&
          !isFlag(next) &&
          /^[A-Za-z][A-Za-z0-9._-]*$/.test(next)
        ) {
          valued.push(word, next)
          i++
        }
      }
      return join(envVars(command), lead, [program], envFlags(args), envArgs(args), valued, leading(args, 3))
    },
  },
  {
    id: "G",
    name: "Names + target flags, in order",
    describe:
      "Read in order: the program, its plain words, and any flag that means a target (--context, --profile, --project, --namespace, --host, --env, -p -n -h -a -c -f -e) with its value, until the first other flag or argument; plus env vars and hosts that name an environment.",
    family: (command) => {
      const { lead, program, args } = split(command)
      /** An env var named in full (`NODE_ENV=production`) replaces its `NAME=…` form. */
      const full = envVars(command)
      const kept = lead.filter((word) => !full.some((env) => word === `${env.slice(0, env.indexOf("="))}=…`))
      return join(full, kept, [program], walk(args), envArgs(args))
    },
  },
  {
    id: "H",
    name: "G + learned",
    describe: "G's flags and environments, with D deciding how many leading words belong.",
    family: (command, history) => {
      const { lead, program, args } = split(command)
      if (!program) return join(lead)
      return join(
        envVars(command),
        lead,
        [program],
        envFlags(args),
        envArgs(args),
        targetFlags(args),
        learned(program, args, history, 3),
      )
    },
  },
  {
    id: "D",
    name: "Learned",
    describe:
      "A leading word is part of the family when it has been seen before in that place, or the place only ever holds a few words.",
    family: (command, history) => {
      const { lead, program, args } = split(command)
      return program ? join(lead, [program], learned(program, args, history, 3)) : join(lead)
    },
  },
  {
    id: "E",
    name: "C2 + learned",
    describe: "C2's environments, with D deciding how many leading words belong.",
    family: (command, history) => {
      const { lead, program, args } = split(command)
      if (!program) return join(lead)
      return join(
        envVars(command),
        lead,
        [program],
        envFlags(args),
        envArgs(args),
        learned(program, args, history, 3),
      )
    },
  },
]
