/** Reading the budget file a proxy writes; what it says is `core/budget.ts`. */

import { readFileSync } from "node:fs"
import { type Budget, parseBudget } from "../core/budget.ts"

export function readBudget(path: string): Budget | undefined {
  try {
    return parseBudget(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}
