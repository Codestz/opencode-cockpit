/**
 * Update notice.
 *
 * OpenCode resolves an unpinned plugin spec (`@latest`) once and then reuses its cached copy, so
 * an install never moves forward on its own. The plugin therefore checks the registry itself, at
 * most once a day, and offers to clear its own cache entry so the next start installs the newer
 * version.
 */

export interface UpdateState {
  /** Version currently running. */
  current: string
  /** Newest version on the registry. */
  latest: string
  /** Cache entry to remove so OpenCode reinstalls, when this is an npm install. */
  cacheDir?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export function shouldCheck(lastCheckedAt: number | undefined, now: number, everyMs = DAY_MS): boolean {
  return lastCheckedAt === undefined || now - lastCheckedAt >= everyMs
}

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

/**
 * The directory OpenCode installed this plugin into, given the resolved module path. Removing it
 * makes the next start reinstall from the registry. Undefined for anything but an npm install.
 */
export function cacheDirFor(target: string | undefined, source: string): string | undefined {
  if (source !== "npm" || !target) return undefined
  const [dir] = target.split(`${"/"}node_modules${"/"}`)
  return dir && dir !== target ? dir : undefined
}

export async function fetchLatestVersion(pkg: string, timeoutMs = 3000): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/vnd.npm.install-v1+json" },
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as { version?: string }
    return body.version
  } catch {
    return undefined // offline, rate limited, private registry: never worth bothering the user
  }
}

/** A plugin entry is a spec, or a spec paired with its options. Both are legal in the config. */
export type PluginEntry = string | [string, unknown]

/**
 * The version this config pins the plugin to, if it pins one.
 *
 * Clearing the cache only helps when OpenCode is free to resolve something newer. Against
 * `opencode-cockpit@0.4.0` it reinstalls 0.4.0, and the update reports success while nothing moves —
 * which is worse than refusing, because the next thing you do is wonder why the version is the same.
 *
 * A path install pins nothing (it is whatever is on disk), and a tag moves on its own, so only a
 * fixed version counts. Scoped names keep their leading `@`: the pin is the *last* one.
 */
export function pinnedVersion(
  entries: ReadonlyArray<PluginEntry> | undefined,
  name: string,
): string | undefined {
  for (const entry of entries ?? []) {
    const spec = typeof entry === "string" ? entry : entry[0]
    if (typeof spec !== "string") continue
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:")) continue
    const at = spec.lastIndexOf("@")
    if (at <= 0 || spec.slice(0, at) !== name) continue
    const version = spec.slice(at + 1)
    if (/^\d+\.\d+\.\d+/.test(version)) return version
  }
  return undefined
}
