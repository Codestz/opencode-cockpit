/** Review's own keys. Defaults equal what the bay hands `baySettings` (`packages/opencode/test/catalog.test.ts`). */

import type { KeyInfo } from "../catalog.ts"

export const REVIEW_KEYS: readonly KeyInfo[] = [
  { key: "variant", type: '"right" | "full"', default: "right", about: "where the pane opens" },
  {
    key: "source",
    type: '"worktree" | "branch"',
    default: "worktree",
    about: "what it reviews on open: uncommitted work, or the whole branch",
  },
]
