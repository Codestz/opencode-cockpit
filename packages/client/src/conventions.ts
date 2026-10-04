/**
 * The second half of `/cockpit-setup`: making Cockpit fit how a person works. What the agent needs
 * for it, read fresh — what this project runs that never ends, which ticket keys its history uses,
 * where its pull requests go, what the instruction files say now — and the one write it makes: a
 * marked `## Cockpit conventions` section in an `AGENTS.md`.
 *
 * Conventions only. How to use Cockpit is already in every request's system prompt (each bay's
 * guidance); what a project's own instructions add is the part no bay can know — "the dev server is
 * `bun dev`", "tickets are COM-…".
 *
 * The section is written here rather than by the agent's edit tool because it has to be the same
 * section every time: a rerun replaces it in place, everything around it is kept byte for byte, and a
 * model asked to "update the section" in someone's instructions file is one rewrite away from
 * tidying the rest.
 */

import { execFileSync } from "node:child_process"
import { join } from "node:path"

// ── The section ────────────────────────────────────────────────────────────────────────────────

export const SECTION_START =
  "<!-- cockpit-conventions: start · written by /cockpit-setup, which updates it in place -->"
export const SECTION_END = "<!-- cockpit-conventions: end -->"
export const SECTION_HEADING = "## Cockpit conventions"

/** Matches a start marker however its tail was edited: the prefix is what marks it. */
const START = /<!--\s*cockpit-conventions:\s*start\b[^>]*-->/g
const END = /<!--\s*cockpit-conventions:\s*end\s*-->/g

export interface Section {
  /** Offsets of the start marker and just past the end marker. */
  start: number
  end: number
  /** What is between the heading and the end marker, trimmed. */
  body: string
}

export type Sections = { ok: true; sections: Section[] } | { ok: false; line: number }

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length

/** Every marked section in a file, in order. A start with no end is an error naming its line. */
export function findSections(text: string): Sections {
  const sections: Section[] = []
  const ends = [...text.matchAll(END)]
  for (const start of text.matchAll(START)) {
    const from = start.index ?? 0
    if (sections.some((section) => from < section.end)) continue
    const end = ends.find((each) => (each.index ?? 0) > from)
    if (!end) return { ok: false, line: lineAt(text, from) }
    const stop = (end.index ?? 0) + end[0].length
    const inner = text.slice(from + start[0].length, end.index).trim()
    const body = inner.startsWith(SECTION_HEADING) ? inner.slice(SECTION_HEADING.length).trim() : inner
    sections.push({ start: from, end: stop, body })
  }
  return { ok: true, sections }
}

/** The body as the agent hands it, without a heading of its own (the section brings one). */
export function cleanBody(body: string): string {
  const text = body.replaceAll("\r\n", "\n").trim()
  return text.startsWith(SECTION_HEADING) ? text.slice(SECTION_HEADING.length).trim() : text
}

export function sectionText(body: string, eol = "\n"): string {
  return [SECTION_START, SECTION_HEADING, "", ...cleanBody(body).split("\n"), SECTION_END].join(eol)
}

export type WriteAction = "created" | "added" | "updated" | "unchanged" | "removed" | "absent"

export type Written =
  | { ok: true; action: WriteAction; text: string | undefined; merged: number }
  | { ok: false; error: string }

/** Cuts `[start, end)` and the blank line that set it apart, so removing a section undoes adding it. */
function cut(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && (text[from - 1] === "\n" || text[from - 1] === "\r")) from--
  const before = text.slice(0, from)
  let after = text.slice(end)
  if (from === 0) after = after.replace(/^\r?\n/, "")
  return before.length > 0 && after.length === 0 ? `${before}\n` : before + after
}

/**
 * The file with its section set to `body`: replaced where it is, added at the end where there is
 * none, removed when `body` is empty. Everything outside the section is kept as it was. Several
 * sections (two runs that raced, a paste) become one, where the first was. `text` undefined is a file
 * that does not exist; `text: undefined` back means delete it — it held nothing but the section.
 */
export function writeSection(text: string | undefined, body: string): Written {
  const content = cleanBody(body)
  const found = findSections(text ?? "")
  if (!found.ok)
    return {
      ok: false,
      error: `the Cockpit section that starts at line ${found.line} has no end marker. Add \`${SECTION_END}\` on its own line where the section ends (or remove the start marker), then call this again.`,
    }
  /** CRLF only for a file written that way throughout; a stray `\r\n` in a LF file is not a style. */
  const eol = text?.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : "\n"
  const [first, ...extra] = found.sections
  if (!first) {
    if (!content) return { ok: true, action: "absent", text, merged: 0 }
    if (text === undefined || text.trim() === "")
      return {
        ok: true,
        action: text === undefined ? "created" : "added",
        text: `${sectionText(content, eol)}${eol}`,
        merged: 0,
      }
    const sep = text.endsWith("\n") ? eol : `${eol}${eol}`
    return { ok: true, action: "added", text: `${text}${sep}${sectionText(content, eol)}${eol}`, merged: 0 }
  }
  let out = text as string
  for (const section of [...extra].reverse()) out = cut(out, section.start, section.end)
  if (!content) {
    out = cut(out, first.start, first.end)
    return { ok: true, action: "removed", text: out.trim() === "" ? undefined : out, merged: extra.length }
  }
  out = out.slice(0, first.start) + sectionText(content, eol) + out.slice(first.end)
  const action = extra.length === 0 && first.body === content && out === text ? "unchanged" : "updated"
  return { ok: true, action, text: out, merged: extra.length }
}

// ── Where it goes ──────────────────────────────────────────────────────────────────────────────

export type InstructionScope = "project" | "global"

export interface InstructionFile {
  scope: InstructionScope
  path: string
  exists: boolean
  /** The section's body when there is one; several are reported as a count. */
  sections: number
  body?: string
  /** The line of a start marker with no end. */
  unclosed?: number
  /**
   * OpenCode 1 reads the first file it finds of a list and stops there: `AGENTS.md` before the
   * project's `CLAUDE.md` (and `CONTEXT.md`), the global `AGENTS.md` before `~/.claude/CLAUDE.md`.
   * Read off 1.18.32's instruction loader. So creating this file stops OpenCode 1 reading that one.
   */
  shadows?: string
}

export function instructionPaths(
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Record<InstructionScope, string> {
  return {
    project: join(directory, "AGENTS.md"),
    global: join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode", "AGENTS.md"),
  }
}

export function readInstructions(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  read: (path: string) => string | undefined,
): InstructionFile[] {
  const paths = instructionPaths(directory, env, home)
  const fallbacks: Record<InstructionScope, string[]> = {
    project: [join(directory, "CLAUDE.md"), join(directory, "CONTEXT.md")],
    global: [join(home, ".claude", "CLAUDE.md")],
  }
  return (["project", "global"] as const).map((scope) => {
    const path = paths[scope]
    const text = read(path)
    const found = findSections(text ?? "")
    const shadows =
      opencode === 1 && text === undefined
        ? fallbacks[scope].find((file) => read(file) !== undefined)
        : undefined
    return {
      scope,
      path,
      exists: text !== undefined,
      sections: found.ok ? found.sections.length : 0,
      ...(found.ok && found.sections[0] ? { body: found.sections[0].body } : {}),
      ...(found.ok ? {} : { unclosed: found.line }),
      ...(shadows ? { shadows } : {}),
    }
  })
}

// ── The project ────────────────────────────────────────────────────────────────────────────────

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
