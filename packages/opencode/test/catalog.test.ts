import { describe, expect, test } from "bun:test"
import { bayKeys, OWN_KEYS } from "@opencode-cockpit/client/catalog"
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
