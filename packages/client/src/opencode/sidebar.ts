import type { Host } from "./host/index.ts"

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

/** A laid-out box: its own width, and the container the host put it in. */
interface Sized {
  width?: number
  parent?: unknown
}

/**
 * How wide a sidebar block really is, measured off the container the host gave it rather than the
 * block: rows wider than the sidebar stretch the block with them, so its own width only ever agreed
 * with the guess. `measured` is 0 before the first layout.
 */
export function measureBlock(block: Sized | undefined): { parent: number; own: number; measured: number } {
  const parent = (block?.parent as { width?: number } | null | undefined)?.width ?? 0
  const own = block?.width ?? 0
  const measured = parent >= 12 ? Math.min(parent, own >= 12 ? own : parent) : own
  return { parent, own, measured }
}

/**
 * The width to draw a block's rows at: measured once laid out, else a guess from the window — a
 * quarter of it, between 20 and `widest`. Guessed too wide, rows run past the edge and are clipped
 * ("3 done" drew as "3 d"); a bay that would rather leave its facts short of the edge guesses narrower.
 */
export function blockWidth(block: Sized | undefined, window: number, widest = 40): number {
  const { measured } = measureBlock(block)
  return measured >= 12 ? measured : Math.max(20, Math.min(widest, Math.floor(window / 4) - 2))
}
