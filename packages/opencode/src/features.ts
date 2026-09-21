/** Every feature the bundle can load. Adding one: list it here and wire it in server.ts / tui.ts. */
export const FEATURES = ["shell", "status", "review", "updater"] as const
export type Feature = (typeof FEATURES)[number]

export interface CockpitOptions {
  /** Switch features off, e.g. `{ "shell": false }`. Everything is on by default. */
  features?: Partial<Record<Feature, boolean>>
  /** Options passed to a single feature, keyed by feature name. */
  shell?: Record<string, unknown>
  status?: Record<string, unknown>
  review?: Record<string, unknown>
  updater?: Record<string, unknown>
  [key: string]: unknown
}

export const BUNDLE = "opencode-cockpit"

export function isEnabled(options: CockpitOptions | undefined, feature: Feature): boolean {
  return options?.features?.[feature] !== false
}

/**
 * Options for one feature. Shell also accepts options at the top level, which is where 0.1.x
 * (when `opencode-cockpit` was Shell) read them from.
 */
export function featureOptions(
  options: CockpitOptions | undefined,
  feature: Feature,
): Record<string, unknown> {
  const own = (options?.[feature] as Record<string, unknown> | undefined) ?? {}
  if (feature !== "shell" || !options) return own
  const legacy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options)) {
    if (key !== "features" && !(FEATURES as readonly string[]).includes(key)) legacy[key] = value
  }
  return { ...legacy, ...own }
}
