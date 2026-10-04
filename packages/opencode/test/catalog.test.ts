import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bayKeys, DEFAULT_KEYS, OWN_KEYS } from "@opencode-cockpit/client/catalog"
import { DEFAULTS as REVIEW } from "../../review/src/core/config.ts"
import { DEFAULTS as SHELL } from "../../shell/src/core/config.ts"
import { KINDS as STATUS } from "../../status/src/core/config.ts"
import { DEFAULTS as SUBAGENTS } from "../../subagents/src/core/config.ts"
import { DEFAULTS as TRUST } from "../../trust/src/core/config.ts"

/**
 * The catalog in `@opencode-cockpit/client` lists every bay's own keys and defaults — for
 * `cockpit_settings` and the `cockpit-setup` skill's reference — but client cannot import the bays.
 * This package depends on all of them, so it is where a bay's defaults and the catalog are held to
 * each other: a key added, removed or re-defaulted in a bay fails here until the catalog says so too.
 */

/** Every key in `defaults` is in the catalog with that default; every catalog key the bay does not default is unset. */
function agrees(bay: Parameters<typeof bayKeys>[0], defaults: Record<string, unknown>) {
  const catalog = bayKeys(bay)
  for (const [key, value] of Object.entries(defaults)) {
    const info = catalog.find((each) => each.key === key)
    expect({ bay, key, listed: info !== undefined }).toEqual({ bay, key, listed: true })
    expect({ bay, key, default: info?.default }).toEqual({ bay, key, default: value })
  }
  for (const info of OWN_KEYS[bay])
    if (!(info.key in defaults))
      expect({ bay, key: info.key, default: info.default }).toEqual({
        bay,
        key: info.key,
        default: undefined,
      })
}

describe("the catalog agrees with every bay's defaults", () => {
  test("shell", () => agrees("shell", SHELL))
  test("subagents", () => agrees("subagents", SUBAGENTS))
  test("trust", () => agrees("trust", { ...TRUST }))
  test("review", () => agrees("review", REVIEW))
  test("updater, whose one key is written inline where it is read", () =>
    agrees("updater", { updateCheck: true }))
  test("trail, which has only the shared keys", () => expect(OWN_KEYS.trail).toEqual([]))

  test("status: the same keys as it checks, and the two booleans it defaults", () => {
    expect(OWN_KEYS.status.map((info) => info.key).sort()).toEqual(Object.keys(STATUS).sort())
    const own = Object.fromEntries(OWN_KEYS.status.map((info) => [info.key, info.default]))
    expect({ icons: own.icons, debug: own.debug }).toEqual({ icons: STATUS.icons, debug: STATUS.debug })
  })
})

/**
 * OpenCode's own `<leader>` letters, as 1.18.32 and 2.0.18 bind them by default — measured from both
 * binaries. A Cockpit default on one of these takes the key from OpenCode (2's `w` closes the tab,
 * `i` shows image attachments; `r` is redo on both), so none may be one.
 */
const OPENCODE_LEADER = new Set("abceghilmnqrstuwxy".split(""))

/** A bay's interface `DEFAULT_KEYS`, read from its source: the keys it actually binds. */
function boundKeys(bay: string): Record<string, string> {
  const source = readFileSync(join(import.meta.dir, "..", "..", bay, "src", "tui", "index.tsx"), "utf8")
  const block = source.match(/const DEFAULT_KEYS = \{([^}]*)\}/)?.[1] ?? ""
  return Object.fromEntries([...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]))
}

describe("default keys", () => {
  const bays = Object.keys(DEFAULT_KEYS) as (keyof typeof DEFAULT_KEYS)[]

  test("each bay binds the catalog's defaults", () => {
    for (const bay of bays)
      expect({ bay, keys: boundKeys(bay) }).toEqual({ bay, keys: { ...DEFAULT_KEYS[bay] } })
  })

  test("every Cockpit default is its own key, and none is one of OpenCode's", () => {
    const keys = bays.flatMap((bay) => Object.values(DEFAULT_KEYS[bay] ?? {}))
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      const letter = key.match(/^<leader>([a-z])$/)?.[1]
      expect({ key, leaderLetter: letter !== undefined }).toEqual({ key, leaderLetter: true })
      expect({ key, opencodes: OPENCODE_LEADER.has(letter as string) }).toEqual({ key, opencodes: false })
    }
  })
})
