import type { Hooks } from "@opencode-ai/plugin"

/**
 * Merges the server hooks of several features into one plugin. Tool maps are unioned (a name
 * clash is a bug, so it throws); function hooks run in feature order, each awaited, which is how
 * OpenCode itself runs hooks from separate plugins.
 */
export function composeHooks(parts: Hooks[]): Hooks {
  const tools: NonNullable<Hooks["tool"]> = {}
  const functions = new Map<string, ((...args: unknown[]) => unknown)[]>()
  const singles: Record<string, unknown> = {}

  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined) continue
      if (key === "tool") {
        for (const [id, def] of Object.entries(value as NonNullable<Hooks["tool"]>)) {
          if (id in tools) throw new Error(`tool "${id}" is registered by more than one cockpit feature`)
          tools[id] = def
        }
      } else if (typeof value === "function") {
        const list = functions.get(key) ?? []
        list.push(value as (...args: unknown[]) => unknown)
        functions.set(key, list)
      } else {
        if (key in singles) throw new Error(`hook "${key}" is provided by more than one cockpit feature`)
        singles[key] = value
      }
    }
  }

  const hooks: Record<string, unknown> = { ...singles }
  for (const [key, list] of functions) {
    hooks[key] =
      list.length === 1
        ? list[0]
        : async (...args: unknown[]) => {
            for (const fn of list) await fn(...args)
          }
  }
  if (Object.keys(tools).length > 0) hooks.tool = tools
  return hooks as Hooks
}
