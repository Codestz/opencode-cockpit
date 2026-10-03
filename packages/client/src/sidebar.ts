import type { Host } from "./host.ts"
import { isSidebarBay, loadSettings, orderOf, type SettingsWhere } from "./settings.ts"

/**
 * Where a bay's block sits in OpenCode's sidebar.
 *
 * Every bay used to take its place from its own setting (Shell's `ui.sidebarOrder`, Status's
 * `statusline.sidebarOrder`…), so putting the statusline first meant knowing three numbers. Now one
 * list in Cockpit's config orders them all, and it is the only order:
 *
 *   { "sidebar": ["status", "subagents", "shell", "trail", "trust"] }
 *
 * in `~/.config/opencode-cockpit/config.json`, or a project's `.cockpit.json` (which replaces it).
 * That list is also the default. A bay the list leaves out follows the ones it names, in default
 * order. A bay's own `sidebarOrder` number is no longer read (`orderOf` in settings.ts, which also
 * says where the numbers sit among OpenCode's own blocks).
 *
 * New code takes `order` from `baySettings`; the two functions here are kept for the bays that have
 * not moved to it yet. Read once, at start — never in a draw path.
 */

export type SidebarWhere = SettingsWhere

/** The configured order, project over global, valid names only; undefined when neither sets one. */
export function sidebarList(where: SidebarWhere = {}): string[] | undefined {
  return loadSettings(where).sidebarList
}

/**
 * @deprecated `baySettings(bay, …).order`. `explicit` — a bay's old `sidebarOrder` — is ignored now;
 * `fallback` only places a name that is not a sidebar bay.
 */
export function sidebarOrder(
  bay: string,
  fallback: number,
  _explicit?: number,
  where: SidebarWhere = {},
): number {
  return isSidebarBay(bay) ? orderOf(loadSettings(where), bay) : fallback
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
