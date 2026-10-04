import type { Host } from "./host.ts"

/**
 * Where the bays' blocks sit in OpenCode's sidebar: one list in Cockpit's settings orders them all,
 *
 *   { "sidebar": ["status", "subagents", "shell", "trail", "trust"] }
 *
 * and each bay takes its place from `baySettings(bay, …).order` (`orderOf` in settings.ts, which also
 * says where the numbers sit among OpenCode's own blocks). What is left here is making both OpenCodes
 * draw that order.
 */

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
