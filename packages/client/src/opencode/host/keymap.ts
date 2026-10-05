/**
 * Keys, without `@opentui/keymap`: the two helpers the bays used, re-made from nothing.
 */

/**
 * OpenCode 2 lets a plugin import `@opentui/core` and `solid-js` and nothing else of OpenTUI: an
 * import of `@opentui/keymap` fails, and a plugin whose module fails to load is skipped without a
 * word (measured on 2.0.15). So the two keymap helpers the bays used are re-made here from nothing.
 */

/** A configured key: a key string, several, an object with a `key`, or `false`/"none" for unbound. */
export type BindingValue = string | false | { key: string } | readonly (string | { key: string })[]
export interface Binding {
  key: string
  cmd: string
  [field: string]: unknown
}

/** `createBindingLookup` as the bays used it: config `{ command: key }` → `{ key, cmd }` bindings. */
export function bindingLookup(config: Readonly<Record<string, BindingValue | undefined>>) {
  const byCommand = new Map<string, Binding[]>()
  for (const [cmd, value] of Object.entries(config)) {
    if (value === undefined || value === false || value === "none") continue
    const items = (Array.isArray(value) ? value : [value]) as (string | { key: string })[]
    const bindings = items.map((item) => (typeof item === "string" ? { key: item, cmd } : { ...item, cmd }))
    if (bindings.length > 0) byCommand.set(cmd, bindings)
  }
  return {
    get: (command: string): Binding[] => byCommand.get(command) ?? [],
    gather: (_name: string, commands: readonly string[]): Binding[] =>
      commands.flatMap((command) => byCommand.get(command) ?? []),
  }
}
