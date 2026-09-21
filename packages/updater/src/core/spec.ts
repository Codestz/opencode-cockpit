/**
 * A plugin spec as a person wrote it in `opencode.json` or `tui.json`.
 *
 * OpenCode installs each spec into a cache directory named after the spec string and never resolves
 * it again, so the only spec that means what it says is an exact version. Everything else — a bare
 * name, `@latest`, `@next`, a range — is frozen at whatever it resolved to the first time.
 */

export type Pin =
  | { type: "exact"; version: string }
  /** `latest`, `next`, `^1.2.0`: anything OpenCode resolves once and then keeps. */
  | { type: "tag"; tag: string }
  | { type: "none" }

export type Spec =
  /** A path, `file:`, or a URL: not something a registry can update. */
  { kind: "local"; raw: string } | { kind: "npm"; raw: string; name: string; pin: Pin }

/** A plugin entry is a spec, or a spec paired with its options. Both are legal in the config. */
export type PluginEntry = string | readonly [string, unknown]

const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/

export function parseSpec(raw: string): Spec {
  const spec = raw.trim()
  if (/^(\.|\/|~|file:)/.test(spec) || /^[a-z][a-z+]*:/i.test(spec)) return { kind: "local", raw }
  // Scoped names keep their leading `@`: the version is after the *last* one.
  const at = spec.lastIndexOf("@")
  if (at <= 0) return { kind: "npm", raw, name: spec, pin: { type: "none" } }
  const name = spec.slice(0, at)
  const rest = spec.slice(at + 1)
  if (!rest) return { kind: "npm", raw, name, pin: { type: "none" } }
  return {
    kind: "npm",
    raw,
    name,
    pin: EXACT.test(rest) ? { type: "exact", version: rest } : { type: "tag", tag: rest },
  }
}

export function specOf(entry: PluginEntry): string | undefined {
  const spec = typeof entry === "string" ? entry : entry[0]
  return typeof spec === "string" ? spec : undefined
}

/** The only spec OpenCode will not freeze at an older release. */
export const exactSpec = (name: string, version: string): string => `${name}@${version}`

/** True when `latest` is a higher release than `current`. Pre-releases never look newer. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(v.trim())
    return match ? { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] } : undefined
  }
  const a = parse(latest)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    const diff = (a.nums[i] as number) - (b.nums[i] as number)
    if (diff !== 0) return diff > 0
  }
  // Same numbers: a release beats the pre-release of that version, never the other way round.
  return a.pre === undefined && b.pre !== undefined
}
