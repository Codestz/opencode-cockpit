/** What npm says is newest. One request per plugin; a failure is `undefined`, shown as `?`. */

export const NPM_REGISTRY = "https://registry.npmjs.org"

/**
 * The registry this person's npm uses, as npm itself reads it from the environment — which is also
 * what `opencode plugin` installs from. Asking npmjs.org about a plugin that lives on a company
 * registry would report it unreachable, or worse, report someone else's package of the same name.
 */
export function registryFrom(env: Readonly<Record<string, string | undefined>>): string {
  return env.npm_config_registry || env.NPM_CONFIG_REGISTRY || NPM_REGISTRY
}

export async function fetchLatest(
  name: string,
  options: { registry?: string; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<string | undefined> {
  const registry = (options.registry ?? NPM_REGISTRY).replace(/\/+$/, "")
  const get = options.fetch ?? fetch
  try {
    const response = await get(`${registry}/${name.replace("/", "%2f")}/latest`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      // Not the abbreviated `application/vnd.npm.install-v1+json`: `/latest` answers that with a
      // 406 (seen 2026-09-21, from Node and Bun alike), which reads as "registry unreachable".
      headers: { accept: "application/json" },
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as { version?: unknown }
    return typeof body.version === "string" ? body.version : undefined
  } catch {
    return undefined // offline, rate limited, private registry: the row says `?`, never guesses
  }
}

export async function fetchAllLatest(
  names: readonly string[],
  options: Parameters<typeof fetchLatest>[1] = {},
): Promise<Map<string, string | undefined>> {
  const versions = await Promise.all(names.map((name) => fetchLatest(name, options)))
  return new Map(names.map((name, i) => [name, versions[i]]))
}
