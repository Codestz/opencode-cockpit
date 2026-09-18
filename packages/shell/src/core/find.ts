import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { kindOfShell, type ShellKind } from "./kind.ts"

/** The command as written, without the `$SHELL -c` wrapper. */
export function commandOf(s: ShellInfo): string {
  return s.args.length === 2 && s.args[0] === "-c" ? (s.args[1] as string) : [s.command, ...s.args].join(" ")
}

export type StatusFilter = "running" | "failed" | "finished" | "any"
export type SessionFilter = "this" | "others" | "any"

export interface ShellFilter {
  /** What the shell is, derived from its command (server, tests, build, watcher, task). */
  kind?: ShellKind | "any"
  /** Case-insensitive text found in the name or the command. */
  query?: string
  status?: StatusFilter
  session?: SessionFilter
  /** The asking agent's session, for `session` filtering. */
  currentSession?: string
  /** Extra kind patterns from config, so a kind it defines is also filterable. */
  kinds?: Record<string, string>
}

export function isFailed(s: ShellInfo): boolean {
  return s.status === "failed" || (s.status === "exited" && s.exitCode !== 0)
}

export function filterShells(list: readonly ShellInfo[], filter: ShellFilter): ShellInfo[] {
  const query = filter.query?.trim().toLowerCase()
  return list.filter((s) => {
    if (filter.kind && filter.kind !== "any" && kindOfShell(s, filter.kinds) !== filter.kind) return false
    if (query && !s.title.toLowerCase().includes(query) && !commandOf(s).toLowerCase().includes(query)) {
      return false
    }
    switch (filter.status ?? "any") {
      case "running":
        if (s.status !== "running") return false
        break
      case "failed":
        if (!isFailed(s)) return false
        break
      case "finished":
        if (s.status === "running") return false
        break
    }
    switch (filter.session ?? "any") {
      case "this":
        return s.owner.session === filter.currentSession
      case "others":
        return s.owner.session !== filter.currentSession
      default:
        return true
    }
  })
}

export type NameMatch =
  | { kind: "found"; shell: ShellInfo; alsoMatched: ShellInfo[] }
  | { kind: "ambiguous"; candidates: ShellInfo[] }
  | { kind: "none"; available: ShellInfo[] }

/**
 * Finds the shell a name refers to. Exact names (ignoring case) beat partial matches on name or
 * command. When several match, a single running shell is the obvious intent (earlier finished
 * shells with the same name are history); otherwise the caller must choose.
 */
export function matchByName(list: readonly ShellInfo[], name: string): NameMatch {
  const wanted = name.trim().toLowerCase()
  const exact = list.filter((s) => s.title.trim().toLowerCase() === wanted)
  const matches =
    exact.length > 0
      ? exact
      : list.filter(
          (s) => s.title.toLowerCase().includes(wanted) || commandOf(s).toLowerCase().includes(wanted),
        )

  if (matches.length === 0) return { kind: "none", available: [...list] }
  if (matches.length === 1) return { kind: "found", shell: matches[0] as ShellInfo, alsoMatched: [] }
  const running = matches.filter((s) => s.status === "running")
  if (running.length === 1) {
    const shell = running[0] as ShellInfo
    return { kind: "found", shell, alsoMatched: matches.filter((s) => s !== shell) }
  }
  return { kind: "ambiguous", candidates: matches }
}
