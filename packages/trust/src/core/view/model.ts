/**
 * What both Trust screens read: every command Trust has counted, once, with where each agent stands
 * on it; the families they group into; and the three numbers that sum a project up.
 *
 * **One command, one place.** The ledger used to split a family by section, so `head -30` was under
 * Answers while `head` was also under Learning and its details repeated. Here a command is one
 * `Command` whatever its agents say about it — trusted for one, two of three for another — and a
 * family one `Family`. The screens draw each once.
 */

import { familyOf, outside } from "../family.ts"
import {
  type Always,
  type Entry,
  keyOf,
  type State,
  standing,
  type Thresholds,
  type Widened,
} from "../ledger.ts"

export interface Reading {
  state: State
  settings: Thresholds
  now: number
}

/** Where one agent stands on one command. */
export type Stand =
  | { kind: "trusted" }
  /** Not trusted by its own count, answered through a family you widened. */
  | { kind: "widened"; family: string }
  | { kind: "counting"; have: number; need: number; expired: boolean }

export function standOf(entry: Entry, { state, settings, now }: Reading): Stand {
  const where = standing(entry, entry.danger, settings, now)
  if (where.trusted) return { kind: "trusted" }
  const family = familyOf(entry.permission, entry.subject)
  if (
    state.widened.has(keyOf(entry.permission, entry.agent, family)) &&
    outside(entry.permission, entry.subject) === undefined
  )
    return { kind: "widened", family }
  return { kind: "counting", have: where.have, need: where.need, expired: where.expired }
}

export const answers = (stand: Stand): boolean => stand.kind !== "counting"

/** Approvals still needed; an expired count is as far as it gets. Zero: it answers. */
export const distance = (stand: Stand): number =>
  stand.kind !== "counting" ? 0 : stand.expired ? Number.MAX_SAFE_INTEGER : stand.need - stand.have

/** One agent's standing on a command. */
export interface Standing {
  entry: Entry
  stand: Stand
}

/**
 * Where a command is, all agents together:
 * - `answering`: Trust answers it for at least one agent;
 * - `learning`: counting, with approvals that matter (two in a row, or answered before);
 * - `once`: approved once and never again — most never come back, so they are kept out of the way.
 */
export type Phase = "answering" | "learning" | "once"

export interface Command {
  /** `[permission, subject]`, the same for every agent. */
  key: string
  permission: string
  subject: string
  family: string
  /** Every agent's standing, the one that answers first, then the closest to it. */
  standings: Standing[]
  phase: Phase
  /** Today's reading of why it costs more, as of the last time it was asked. */
  danger?: string
  /** The last approval or answer, any agent. */
  lastAt: number
}

export const commandKey = (permission: string, subject: string): string =>
  JSON.stringify([permission, subject])

/** The standing the command is drawn by: the one that answers, else the closest. */
export const leadOf = (command: Command): Standing => command.standings[0] as Standing

/** Approvals the closest agent still needs. */
export const closeness = (command: Command): number => distance(leadOf(command).stand)

function phaseOf(standings: readonly Standing[]): Phase {
  if (standings.some((each) => answers(each.stand))) return "answering"
  const once = standings.every(
    (each) => each.stand.kind === "counting" && each.stand.have <= 1 && each.entry.autos === 0,
  )
  return once ? "once" : "learning"
}

/**
 * Every command anyone approved or Trust answered, one each. A subject only ever rejected has
 * nothing to show and is left out.
 */
export function commandsOf(reading: Reading): Command[] {
  const byKey = new Map<string, Standing[]>()
  for (const entry of reading.state.entries.values()) {
    if (entry.approvals === 0 && entry.autos === 0) continue
    const key = commandKey(entry.permission, entry.subject)
    const list = byKey.get(key) ?? []
    list.push({ entry, stand: standOf(entry, reading) })
    byKey.set(key, list)
  }
  const out: Command[] = []
  for (const [key, standings] of byKey) {
    standings.sort((a, b) => distance(a.stand) - distance(b.stand) || b.entry.lastAt - a.entry.lastAt)
    const first = (standings[0] as Standing).entry
    const danger = standings.find((each) => each.entry.danger)?.entry.danger
    out.push({
      key,
      permission: first.permission,
      subject: first.subject,
      family: familyOf(first.permission, first.subject),
      standings,
      phase: phaseOf(standings),
      ...(danger ? { danger } : {}),
      lastAt: Math.max(...standings.map((each) => each.entry.lastAt)),
    })
  }
  return out
}

/** Answering newest first; then learning closest first, a dangerous one after the rest; then once. */
export function byPhase(a: Command, b: Command): number {
  const order: Record<Phase, number> = { answering: 0, learning: 1, once: 2 }
  return (
    order[a.phase] - order[b.phase] ||
    (a.phase === "learning"
      ? Number(a.danger !== undefined) - Number(b.danger !== undefined) || closeness(a) - closeness(b)
      : 0) ||
    b.lastAt - a.lastAt
  )
}

export interface Family {
  /** `[permission, family]`. */
  key: string
  permission: string
  family: string
  /** Its commands, `byPhase`. */
  commands: Command[]
  /** The agents you trusted the whole family for. */
  widened: Widened[]
  lastAt: number
}

/**
 * A widening no command falls in any more: most often one made under the old family rule ("any docker
 * compose"), which now answers nothing, since a family is matched whole. `x` removes it.
 */
export const stale = (family: Family): boolean => family.widened.length > 0 && family.commands.length === 0

export const familyKey = (permission: string, family: string): string => JSON.stringify([permission, family])

/** Where a family sorts: what answers, then what learns, then what is dangerous, then what was seen once. */
function familyRank(family: Family): number {
  if (family.widened.length > 0) return 0
  const best = family.commands[0]
  if (!best) return 4
  if (best.phase === "answering") return 0
  if (best.phase === "once") return 3
  return best.danger ? 2 : 1
}

/**
 * The commands grouped by family, with every widened family — even one with no command left. Families
 * that answer first (newest first), then those learning (closest first), the dangerous ones after,
 * and families seen only once last.
 */
export function familiesOf(reading: Reading, commands: readonly Command[] = commandsOf(reading)): Family[] {
  const families = new Map<string, Family>()
  const familyFor = (permission: string, family: string) => {
    const key = familyKey(permission, family)
    let found = families.get(key)
    if (!found) {
      found = { key, permission, family, commands: [], widened: [], lastAt: 0 }
      families.set(key, found)
    }
    return found
  }
  for (const command of commands) {
    const family = familyFor(command.permission, command.family)
    family.commands.push(command)
    family.lastAt = Math.max(family.lastAt, command.lastAt)
  }
  for (const widened of reading.state.widened.values()) {
    const family = familyFor(widened.permission, widened.family)
    family.widened.push(widened)
    family.lastAt = Math.max(family.lastAt, widened.at)
  }
  for (const family of families.values()) family.commands.sort(byPhase)
  const closest = (family: Family) => (family.commands[0] ? closeness(family.commands[0]) : 0)
  return [...families.values()].sort(
    (a, b) =>
      familyRank(a) - familyRank(b) ||
      (familyRank(a) === 1 || familyRank(a) === 2 ? closest(a) - closest(b) : 0) ||
      b.lastAt - a.lastAt,
  )
}

/** The project in three numbers, one per command. */
export interface Counts {
  trusted: number
  learning: number
  once: number
}

export function countsOf(commands: readonly Command[]): Counts {
  const counts: Counts = { trusted: 0, learning: 0, once: 0 }
  for (const command of commands)
    if (command.phase === "answering") counts.trusted++
    else if (command.phase === "learning") counts.learning++
    else counts.once++
  return counts
}

/** OpenCode's own "always" approvals, one group per agent and permission, the newest first. */
export interface AlwaysGroup {
  key: string
  permission: string
  agent: string
  patterns: string[]
  at: number
  approvals: Always[]
}

export function alwaysGroups(state: State): AlwaysGroup[] {
  const groups = new Map<string, AlwaysGroup>()
  for (const always of state.always) {
    const key = JSON.stringify([always.permission, always.agent])
    const found = groups.get(key)
    if (found) {
      for (const pattern of always.patterns)
        if (!found.patterns.includes(pattern)) found.patterns.push(pattern)
      found.at = Math.max(found.at, always.at)
      found.approvals.push(always)
    } else
      groups.set(key, {
        key,
        permission: always.permission,
        agent: always.agent,
        patterns: [...always.patterns],
        at: always.at,
        approvals: [always],
      })
  }
  return [...groups.values()].sort((a, b) => b.at - a.at)
}
