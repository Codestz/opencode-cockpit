/**
 * Families worth widening, suggested — never widened (#45).
 *
 * Exact rules converge slowly on real work: most lines carry one command never seen before (a new
 * path in a `sed -n`), so a family a person approves all day may never have one exact command trusted.
 * A family Trust may learn by itself is a read (effect.ts); every other family stays a person's call,
 * and this is Trust making that call easy to see: when one agent's approvals across a family reach the
 * threshold, the ledger offers `w` for it, once, until it is widened or dismissed.
 *
 * Never suggested: a family that is already widened or learned for that agent, one a widening refuses
 * (dangerous — `family.widenable`), one dismissed or widened and undone before, and one with a single
 * command — its own count already says what a family would.
 */

import { widenable } from "./family.ts"
import { keyOf } from "./ledger.ts"
import { type Family, type Reading, standOf } from "./view/model.ts"

export interface Suggestion {
  /** `keyOf(permission, family)`. */
  key: string
  family: Family
  /** Approvals in a row still counting, across the family's commands. */
  approvals: number
  /** Commands in the family with approvals that count. */
  commands: number
}

/**
 * Kinds a suggestion is made for: commands, edits and reads by folder, searches and web queries as a
 * tool. Fetches (a host), agents and skills are as wide as they go already.
 */
const SUGGESTED = new Set(["bash", "edit", "read", "glob", "grep", "websearch"])

export function suggestionsOf(reading: Reading, families: readonly Family[]): Suggestion[] {
  const { state, settings } = reading
  const out: Suggestion[] = []
  for (const family of families) {
    if (!SUGGESTED.has(family.permission) || !widenable(family.permission, family.family).ok) continue
    const sum = { approvals: 0, commands: 0 }
    for (const command of family.commands)
      for (const { entry } of command.standings) {
        const stand = standOf(entry, reading)
        if (stand.kind !== "counting" || stand.have === 0 || entry.danger) continue
        sum.approvals += stand.have
        sum.commands++
      }
    const key = keyOf(family.permission, family.family)
    if (state.widened.has(key) || state.dismissed.has(key)) continue
    if (sum.commands < 2 || sum.approvals < settings.threshold) continue
    out.push({ key, family, ...sum })
  }
  return out.sort((a, b) => b.approvals - a.approvals)
}
