/**
 * The host's command palette, and the key that opens it.
 *
 * The review's keys are a *global* layer — the only kind that fires (see `tui/panel/keys.ts`) — so
 * while it is open it owns `j`, `k`, `enter`, `escape` and most of the alphabet. `ctrl+p` opened
 * OpenCode's palette underneath the panel, and every letter typed into it moved the review instead:
 * the palette looked dead. So the review watches for the palette's own key and steps aside.
 */

/** A key as the keymap reports it — the fields a binding names. */
export interface KeyLike {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

/**
 * The palette's bindings, as the person's config has them (`keybinds.command_list`), default `ctrl+p`.
 *
 * Leader chords are left out: the leader key alone arrives first and means something else, and the
 * chord's second key is not one the review could tell apart from its own.
 */
export function paletteBindings(config: unknown): string[] {
  const value = (config as { keybinds?: { command_list?: unknown } } | undefined)?.keybinds?.command_list
  const raw = typeof value === "string" && value.trim() !== "" ? value : "ctrl+p"
  if (raw.trim() === "none") return []
  return raw
    .split(",")
    .map((binding) => binding.trim().toLowerCase())
    .filter((binding) => binding !== "" && !binding.includes("<leader>"))
}

/** Whether `key` is `binding` (`ctrl+p`, `ctrl+shift+k`, `f2`) — every modifier exactly. */
export function matchesBinding(key: KeyLike, binding: string): boolean {
  const parts = binding.toLowerCase().split("+")
  const name = parts.pop()
  const modifiers = new Set(parts)
  return (
    key.name?.toLowerCase() === name &&
    Boolean(key.ctrl) === modifiers.has("ctrl") &&
    Boolean(key.meta) === (modifiers.has("meta") || modifiers.has("alt")) &&
    Boolean(key.shift) === modifiers.has("shift")
  )
}
