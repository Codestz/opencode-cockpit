import type { WatchRule } from "@opencode-cockpit/protocol/shell"
import type { CockpitConfig } from "../../core/config.ts"

export type WatchRequest = { preset?: string; rule?: WatchRule }

/** A backslash that JSON does not allow — `\d`, `\s`, `\(` — i.e. someone wrote a regex in here. */
const LONE_ESCAPE = /\\(?!["\\/bfnrtu])/g

/**
 * Rules are regexes, and a regex written inside JSON text is usually under-escaped (`"\d+ passed"`
 * is not valid JSON). Parse it as written first, then again with those backslashes escaped, so a
 * model's JSON does not have to be perfect for its patterns to survive.
 */
function parseLoosely(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(text.replace(LONE_ESCAPE, "\\\\"))
    } catch {
      return undefined // not JSON at all: treated as a preset name, which says so downstream
    }
  }
}

/** The keys a rule may carry; anything else in an object is not a rule. */
const RULE_KEYS = new Set(["done", "fail", "ok", "ignoreCase", "idleSeconds"])

/**
 * Turns whatever the model passed for `watch` into what `shell.watch` needs.
 *
 * `true`/`"auto"` asks the daemon to pick a preset, a name picks that preset — and a preset defined
 * in config travels as an explicit rule, so users can add tools without touching the daemon. Rule
 * objects arrive as JSON *strings* often enough (models write one, and tool args are not always
 * parsed the way the schema says) that a string which looks like an object is parsed rather than
 * handed on as a preset name nobody has.
 */
export function watchArgs(watch: unknown, config: CockpitConfig): WatchRequest {
  const rule = asWatchRule(watch)
  if (rule) return { rule }
  const preset = watch === true || watch == null ? "auto" : String(watch)
  const custom = config.watch?.presets?.[preset]
  return custom ? { rule: custom } : { preset }
}

/** A rule from an object, or from the JSON string a model sometimes writes instead. */
export function asWatchRule(value: unknown): WatchRule | undefined {
  let candidate = value
  if (typeof candidate === "string") {
    const text = candidate.trim()
    if (!text.startsWith("{")) return undefined
    const parsed = parseLoosely(text)
    if (parsed === undefined) return undefined
    candidate = parsed
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined
  const entries = Object.entries(candidate).filter(([k, v]) => RULE_KEYS.has(k) && v != null)
  return entries.length > 0 ? (Object.fromEntries(entries) as WatchRule) : undefined
}
