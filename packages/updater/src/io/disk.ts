/**
 * The real filesystem behind core's `Disk`.
 *
 * Node APIs only: the same code runs inside OpenCode (Bun) and under `npx` (Node).
 */

import { readdirSync, readFileSync } from "node:fs"
import type { Disk } from "../core/disk.ts"

export const nodeDisk: Disk = {
  read(path) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  },
  list(path) {
    try {
      return readdirSync(path)
    } catch {
      return []
    }
  },
}
