/** Trust's own keys. Defaults equal what the bay hands `baySettings` (`packages/opencode/test/catalog.test.ts`). */

import type { KeyInfo } from "../catalog.ts"

export const TRUST_KEYS: readonly KeyInfo[] = [
  {
    key: "threshold",
    type: "number",
    default: 3,
    about: "approvals in a row, by you, before Trust answers",
  },
  { key: "dangerExtra", type: "number", default: 5, about: "what a dangerous command costs on top" },
  {
    key: "expireDays",
    type: "number",
    default: 30,
    about: "days unused before trust has to be earned again; `0` never",
  },
]
