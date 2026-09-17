/**
 * Guards against loading the same cockpit feature twice, e.g. when both `opencode-cockpit` and
 * `@opencode-cockpit/shell` are configured. OpenCode does not deduplicate plugin tools, and
 * duplicate tool names make model requests fail, so the first copy loaded wins and later copies
 * stay inactive.
 *
 * Claims are scoped to an object that all plugins of one OpenCode instance share: the plugin
 * input on the server side, the renderer in the TUI. Separate instances claim independently.
 */

const REGISTRY = Symbol.for("opencode-cockpit.features")

type Registry = WeakMap<object, Map<string, string>>

function registry(): Registry {
  const host = globalThis as { [REGISTRY]?: Registry }
  host[REGISTRY] ??= new WeakMap()
  return host[REGISTRY]
}

export interface FeatureClaim {
  /** True when this copy owns the feature and should register itself. */
  active: boolean
  /** Source label of the copy that owns the feature. */
  owner: string
  /** Give up ownership, so a reloaded plugin can claim again. No-op for inactive claims. */
  release(): void
}

export function claimFeature(scope: object, feature: string, source: string): FeatureClaim {
  const reg = registry()
  let claims = reg.get(scope)
  if (!claims) {
    claims = new Map()
    reg.set(scope, claims)
  }
  const owner = claims.get(feature)
  if (owner !== undefined) return { active: false, owner, release() {} }

  claims.set(feature, source)
  let released = false
  return {
    active: true,
    owner: source,
    release() {
      if (released) return
      released = true
      if (claims.get(feature) === source) claims.delete(feature)
    },
  }
}

export function duplicateFeatureMessage(feature: string, owner: string, skipped: string): string {
  return `${feature} is configured twice (${owner} and ${skipped}). Using ${owner}; remove one of them from your OpenCode config.`
}
