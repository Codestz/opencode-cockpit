/**
 * The one Cockpit-wide line in the system prompt: where the user sees what the agent made.
 *
 * Each bay knows only itself — "your background shells, in the sidebar" — and hands that fragment
 * over as `ServerParts.surfaces`. The line is written once for the whole window from every bay that
 * is loaded and on, so a model told "the user sees this in the sidebar" points there instead of
 * pasting a list the user already has on screen. Once, not per bay: the bundle composes its bays'
 * fragments into one entry, and separate installs share a registry on the instance's scope, where
 * the first entry still loaded says the line for all of them.
 */

import { DEFAULT_KEYS } from "./catalog.ts"
import type { Bay } from "./settings.ts"

/** What one bay shows the user, and where. */
export interface Surface {
  /** As the line names it: `your background shells`, `review threads`. */
  what: string
  /** Where it is drawn; the sidebar by default. Those in the sidebar are named together. */
  where?: string
  /** How to open it, as the user types it: `ctrl+x o`, `/trail`. */
  open?: string
}

const IN_SIDEBAR = "the sidebar"

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

const named = (surface: Surface) => (surface.open ? `${surface.what} (${surface.open})` : surface.what)

/**
 * The line, or nothing when no bay shows anything:
 *
 *   The user sees your background shells (ctrl+x o) and subagents (ctrl+x d) in the sidebar, and
 *   review threads in Review (ctrl+x v): point them there instead of pasting those lists.
 */
export function surfacesLine(surfaces: readonly Surface[]): string | undefined {
  if (surfaces.length === 0) return undefined
  const places = new Map<string, Surface[]>()
  for (const surface of surfaces) {
    const where = surface.where ?? IN_SIDEBAR
    places.set(where, [...(places.get(where) ?? []), surface])
  }
  /** A place of its own is what the key opens: `review threads in Review (ctrl+x v)`. */
  const parts = [...places].map(([where, here]) =>
    here.length === 1 && where !== IN_SIDEBAR && here[0]?.open
      ? `${here[0].what} in ${where} (${here[0].open})`
      : `${listed(here.map(named))} in ${where}`,
  )
  /** Each part may hold an "and" of its own, so the parts are joined with a comma before theirs. */
  const all = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
  return `The user sees ${all}: point them there instead of pasting those lists.`
}

/**
 * A key as the user presses it. `<leader>` is OpenCode's prefix, `ctrl+x` unless they changed it
 * in OpenCode's own config, which the agent side does not read. The first of several keys; `none`
 * (a key turned off) is no key.
 */
export function keyText(key: string | undefined): string | undefined {
  const first = key?.split(",")[0]?.trim()
  if (!first || first === "none") return undefined
  return first.replace(/^<leader>\s*/, "ctrl+x ")
}

/**
 * How the user opens a bay's view: its key as the settings have it (the bay's default unless
 * `keybinds` changes it), or its slash command when the key is turned off.
 */
export function openText(
  bay: Bay,
  command: string,
  keybinds: Readonly<Record<string, string>> | undefined,
  slash: string,
): string {
  return keyText(keybinds?.[command] ?? DEFAULT_KEYS[bay]?.[command]) ?? `/${slash}`
}

// ── once per window ───────────────────────────────────────────────────────────────────────────

const REGISTRY = Symbol.for("opencode-cockpit.surfaces")

type Entry = { surfaces: readonly Surface[] }
type Registry = WeakMap<object, Entry[]>

function registry(): Registry {
  const host = globalThis as { [REGISTRY]?: Registry }
  host[REGISTRY] ??= new WeakMap()
  return host[REGISTRY]
}

export interface SurfaceEntry {
  /** The line for every entry in the scope, when this entry is the one that says it; else nothing. */
  line(): string | undefined
  /** Leave the scope: a reloaded plugin registers again, and the next entry says the line. */
  release(): void
}

/** One plugin entry's fragments, registered with every other Cockpit entry of the same OpenCode. */
export function registerSurfaces(scope: object, surfaces: readonly Surface[]): SurfaceEntry {
  const reg = registry()
  const entries = reg.get(scope) ?? []
  reg.set(scope, entries)
  const entry: Entry = { surfaces }
  entries.push(entry)
  return {
    line: () => (entries[0] === entry ? surfacesLine(entries.flatMap((each) => each.surfaces)) : undefined),
    release: () => {
      const at = entries.indexOf(entry)
      if (at >= 0) entries.splice(at, 1)
    },
  }
}
