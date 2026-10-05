/** Updater's own keys. Defaults equal what the bay hands `baySettings` (`packages/opencode/test/catalog.test.ts`). */

import type { KeyInfo } from "../catalog.ts"

export const UPDATER_KEYS: readonly KeyInfo[] = [
  {
    key: "updateCheck",
    type: "boolean",
    default: true,
    about: "check for plugin updates once a day and say so",
  },
]
