import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Host } from "./host.ts"

/**
 * Where a bay's block sits in OpenCode's sidebar.
 *
 * Every bay used to take its place from its own setting (Shell's `ui.sidebarOrder`, Status's
 * `statusline.sidebarOrder`…), so putting the statusline first meant knowing three numbers. Now one
 * list in Cockpit's config orders them all:
 *
 *   { "sidebar": ["status", "subagents", "shell"] }
 *
 * in `~/.config/opencode-cockpit/config.json`, or a project's `.cockpit.json` (which wins). A bay's
 * own explicit number still beats the list, and a bay the list leaves out keeps its default.
 *
 * Read once, at start — never in a draw path.
 */

/** Positions the list hands out: before every default (Status 140, Subagents 150, Shell 170). */
const FIRST = 100
const STEP = 10

function readList(file: string): string[] | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { sidebar?: unknown }
    return Array.isArray(parsed.sidebar)
      ? parsed.sidebar.filter((name): name is string => typeof name === "string")
      : undefined
  } catch {
    return undefined
  }
}

export interface SidebarWhere {
  /** The project directory, for its `.cockpit.json`. */
  directory?: string
  env?: Record<string, string | undefined>
  home?: string
}

/** The configured order, project over global; undefined when neither sets one. */
export function sidebarList(where: SidebarWhere = {}): string[] | undefined {
  const env = where.env ?? process.env
  const home = where.home ?? homedir()
  const global = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode-cockpit", "config.json")
  const project = where.directory ? readList(join(where.directory, ".cockpit.json")) : undefined
  return project ?? readList(global)
}

export function sidebarOrder(
  bay: string,
  fallback: number,
  explicit: number | undefined,
  where: SidebarWhere = {},
): number {
  if (typeof explicit === "number") return explicit
  const at = sidebarList(where)?.indexOf(bay) ?? -1
  return at >= 0 ? FIRST + at * STEP : fallback
}

type Register = Host["slots"]["register"]
type Registration = Parameters<Register>[0]

/**
 * A host whose sidebar blocks are held back, then registered in their order by `flush`.
 *
 * OpenCode 1 sorts slots by `order`; OpenCode 2 draws them in the order they were registered and
 * ignores it — so on 2 the sidebar came out in whatever order the bays happened to start. The bundle
 * starts every bay on this host and flushes once they are all up, and both OpenCodes agree. Every
 * other slot passes straight through.
 */
export function orderedSidebar(host: Host): { host: Host; flush: () => void } {
  const held: Registration[] = []
  const register: Register = (input) => {
    const { sidebar_content, ...rest } = input.slots
    if (Object.keys(rest).length > 0) host.slots.register({ ...input, slots: rest })
    if (sidebar_content) held.push({ ...input, slots: { sidebar_content } })
  }
  return {
    host: new Proxy(host, {
      get: (target, key, receiver) =>
        key === "slots" ? { ...target.slots, register } : Reflect.get(target, key, receiver),
    }),
    flush() {
      const sorted = held.splice(0).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      for (const registration of sorted) host.slots.register(registration)
    },
  }
}
