/**
 * What a project runs and uses, read fresh for the section: commands that never end, ticket keys in
 * its history, where its pull requests go.
 */

import { execFileSync } from "node:child_process"
import { join } from "node:path"

/** A command that does not end on its own: a dev server, a watcher, `docker compose up`. */
export interface LongRunning {
  command: string
  /** Where it was found, as the person would recognise it: `package.json "dev": "vite"`. */
  from: string
  /** A short name for the shell: the script's or the target's. */
  name: string
}

export interface ProjectFacts {
  /** `bun`, `pnpm`, `yarn` or `npm`, from the lockfile; undefined with no package.json. */
  packageManager?: string
  longRunning: LongRunning[]
  /** The package.json scripts not counted as long-running. */
  otherScripts: string[]
  /** Ticket prefixes seen in branch names and recent commit subjects, most used first. */
  tickets: { prefix: string; count: number; example: string }[]
  /** Where pull requests go: each remote as `host/owner/repo`, credentials removed. */
  remotes: { name: string; repo: string }[]
}

const LONG_NAME =
  /^(dev|start|serve|server|watch|preview|storybook)$|[:_-](dev|watch|serve|server)$|^(dev|watch|serve)[:_-]/
const LONG_COMMAND =
  /--watch\b|(^|\s)watch(\s|$)|\bnodemon\b|\bvite\b(?!\s+build)|\bnext (dev|start)\b|\bnuxt dev\b|\bastro dev\b|\bstorybook dev\b|\bwebpack serve\b|\bdocker[- ]compose up\b|\bwrangler dev\b|\bng serve\b|\bexpo start\b|\btsx watch\b|\bbun --hot\b|\bbun --watch\b/

const isLong = (name: string, command: string) => LONG_NAME.test(name) || LONG_COMMAND.test(command)

const LOCKFILES: [string, string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
]

const runScript = (manager: string, script: string) =>
  manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`

function packageScripts(
  directory: string,
  read: (path: string) => string | undefined,
): Pick<ProjectFacts, "packageManager" | "longRunning" | "otherScripts"> {
  const text = read(join(directory, "package.json"))
  if (text === undefined) return { longRunning: [], otherScripts: [] }
  let scripts: Record<string, unknown> = {}
  let declared: string | undefined
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, unknown>; packageManager?: unknown }
    scripts = parsed.scripts ?? {}
    if (typeof parsed.packageManager === "string") declared = parsed.packageManager.split("@")[0]
  } catch {
    return { longRunning: [], otherScripts: [] }
  }
  const manager =
    LOCKFILES.find(([file]) => read(join(directory, file)) !== undefined)?.[1] ?? declared ?? "npm"
  const longRunning: LongRunning[] = []
  const otherScripts: string[] = []
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") continue
    if (isLong(name, command))
      longRunning.push({
        command: runScript(manager, name),
        from: `package.json "${name}": "${command}"`,
        name,
      })
    else otherScripts.push(name)
  }
  return { packageManager: manager, longRunning, otherScripts }
}

/** `make dev`, `make watch`…: targets named for a server or a watcher, or whose recipe is one. */
function makeTargets(directory: string, read: (path: string) => string | undefined): LongRunning[] {
  const text = read(join(directory, "Makefile")) ?? read(join(directory, "makefile"))
  if (text === undefined) return []
  const out: LongRunning[] = []
  const lines = text.split("\n")
  lines.forEach((line, at) => {
    const target = /^([A-Za-z][\w.-]*)\s*:(?!=)/.exec(line)?.[1]
    if (!target || target.startsWith(".")) return
    const recipe: string[] = []
    for (const next of lines.slice(at + 1)) {
      if (!next.startsWith("\t")) break
      recipe.push(next.trim())
    }
    if (isLong(target, recipe.join(" ")))
      out.push({ command: `make ${target}`, from: `Makefile target "${target}"`, name: target })
  })
  return out
}

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]

function composeUp(directory: string, read: (path: string) => string | undefined): LongRunning[] {
  for (const file of COMPOSE_FILES) {
    const text = read(join(directory, file))
    if (text === undefined) continue
    const services: string[] = []
    let inServices = false
    for (const line of text.split("\n")) {
      if (/^\S/.test(line)) inServices = /^services:\s*$/.test(line)
      else if (inServices) {
        const name = /^ {2}([\w.-]+):\s*$/.exec(line)?.[1]
        if (name) services.push(name)
      }
    }
    const named = services.length > 0 ? ` (services: ${services.join(", ")})` : ""
    return [{ command: "docker compose up", from: `${file}${named}`, name: "compose" }]
  }
  return []
}

function procfile(directory: string, read: (path: string) => string | undefined): LongRunning[] {
  return ["Procfile.dev", "Procfile"].flatMap((file) =>
    (read(join(directory, file)) ?? "").split("\n").flatMap((line) => {
      const match = /^([\w-]+):\s*(.+)$/.exec(line.trim())
      return match
        ? [{ command: (match[2] as string).trim(), from: `${file} "${match[1]}"`, name: match[1] as string }]
        : []
    }),
  )
}

/** Looks like a ticket key but is a standard or an encoding. */
const NOT_TICKETS = new Set([
  "UTF",
  "ISO",
  "SHA",
  "RFC",
  "HTTP",
  "TLS",
  "CVE",
  "ES",
  "IE",
  "MD",
  "AES",
  "RSA",
  "WCAG",
  "PEP",
])

export function ticketPrefixes(lines: readonly string[]): ProjectFacts["tickets"] {
  const seen = new Map<string, { count: number; example: string }>()
  for (const line of lines) {
    for (const match of line.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g)) {
      const prefix = match[1] as string
      if (NOT_TICKETS.has(prefix)) continue
      const entry = seen.get(prefix) ?? { count: 0, example: match[0] }
      entry.count++
      seen.set(prefix, entry)
    }
  }
  return [...seen.entries()]
    .map(([prefix, { count, example }]) => ({ prefix, count, example }))
    .filter((ticket) => ticket.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

/** `git@github.com:acme/app.git`, `https://user:tok@github.com/acme/app` → `github.com/acme/app`. */
export function repoOf(url: string): string {
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(url)
  const path = scp ? `${scp[1]}/${scp[2]}` : url.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]*@/, "")
  return path.replace(/\.git$/, "").replace(/\/+$/, "")
}

/** Runs git in the project, or says nothing. */
export type GitRun = (args: string[]) => string | undefined

export function gitIn(directory: string): GitRun {
  return (args) => {
    try {
      return execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      })
    } catch {
      return undefined
    }
  }
}

export function projectFacts(
  directory: string,
  read: (path: string) => string | undefined,
  git: GitRun = gitIn(directory),
): ProjectFacts {
  const scripts = packageScripts(directory, read)
  const history = [
    ...(git(["branch", "--all", "--format=%(refname:short)"]) ?? "").split("\n"),
    ...(git(["log", "-200", "--format=%s"]) ?? "").split("\n"),
  ]
  const remotes = new Map<string, string>()
  for (const line of (git(["remote", "-v"]) ?? "").split("\n")) {
    const [name, url] = line.split(/\s+/)
    if (name && url && !remotes.has(name)) remotes.set(name, repoOf(url))
  }
  return {
    ...(scripts.packageManager ? { packageManager: scripts.packageManager } : {}),
    longRunning: [
      ...scripts.longRunning,
      ...makeTargets(directory, read),
      ...composeUp(directory, read),
      ...procfile(directory, read),
    ],
    otherScripts: scripts.otherScripts,
    tickets: ticketPrefixes(history),
    remotes: [...remotes.entries()].map(([name, repo]) => ({ name, repo })),
  }
}
