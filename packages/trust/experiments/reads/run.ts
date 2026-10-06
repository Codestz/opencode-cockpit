#!/usr/bin/env bun
/**
 * How much of a real day Trust would answer, under the rules of each release — replayed from ledgers,
 * printed as counts only. No command, path or argument from a ledger is printed or written anywhere:
 * a blocker is named by its program (when it is named like one) and the reason, never its words.
 *
 *   bun packages/trust/experiments/reads/run.ts                  every ledger on this machine
 *   bun packages/trust/experiments/reads/run.ts <events.ndjson>…  these ledgers (a masked one too)
 *   … --day2                                                     the same day again, scored alone
 *
 * Each request is taken in order, as it was asked. If a scenario's rules trust every part of it, Trust
 * answers it — which earns nothing, as in real use. Otherwise what the person did is applied: the
 * approval or reject the ledger recorded, or nothing. A request answered early never adds to a streak
 * later, so the numbers are what that release would have done that day, not what it could have.
 *
 * The danger the ledger recorded wins over today's reading of the subject: a masked ledger can hide
 * what made a command dangerous (a production id inside a masked value).
 *
 * Trust is a project's (0.11): every scenario counts approvals by any agent towards one rule. 0.10.2
 * counted per agent and answered 1.4% of the day below; the replay no longer reproduces that.
 *
 * Measured on one user's working day (434 requests), the run that #44 and #45 came from:
 *
 *   A  exact only                                1.6%   day 2  6.2%
 *   B  exact + the 7 widenings made               2.1%          24.9%
 *   C  0.11: exact + learned reads               22.4%          35.9%
 *   E  0.11: C + every suggestion accepted       31.1%          54.8%
 *   dangerous commands answered, every scenario: 0
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { notReadSubject, readSubject } from "../../src/core/family.ts"
import {
  apply,
  DAY,
  type Event,
  emptyState,
  type Item,
  keyOf,
  parseLines,
  standing,
} from "../../src/core/ledger.ts"
import { widenedFor } from "../../src/core/policy.ts"
import { suggestionsOf } from "../../src/core/suggest.ts"
import { commandsOf, familiesOf } from "../../src/core/view/model.ts"

const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
const args = process.argv.slice(2)
const DAY2 = args.includes("--day2")
const files = args.filter((arg) => !arg.startsWith("--"))

function localLedgers(): string[] {
  const base = join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "opencode-cockpit",
    "trust",
  )
  if (!existsSync(base)) return []
  return readdirSync(base)
    .map((dir) => join(base, dir, "events.ndjson"))
    .filter((file) => existsSync(file))
}

/** A secret file a masking tool wrote as `‹secret-file #…›` reads as one again. */
const unmask = (subject: string) => subject.replace(/‹secret-file #([0-9a-f]+)›/g, ".env.masked-$1")

interface Req {
  id: string
  at: number
  agent: string
  permission: string
  items: Item[]
  outcome?: "approved" | "rejected"
}

/** Requests in the order they were asked, and the widenings a person made, from one ledger. */
function readLedger(file: string): { requests: Req[]; widenings: Event[] } {
  const events = parseLines(`${readFileSync(file, "utf8")}\n`).events.sort((a, b) => a.at - b.at)
  const byId = new Map<string, Req>()
  const widenings: Event[] = []
  for (const event of events) {
    if (event.type === "widened") widenings.push(event)
    if (!("request" in event)) continue
    let req = byId.get(event.request)
    if (!req) {
      req = { id: event.request, at: event.at, agent: event.agent, permission: event.permission, items: [] }
      byId.set(event.request, req)
    }
    if (event.items.length > 0)
      req.items = event.items.map((item) => ({ ...item, subject: unmask(item.subject) }))
    if ((event.type === "approved" || event.type === "rejected") && !req.outcome) req.outcome = event.type
  }
  const requests = [...byId.values()].sort((a, b) => a.at - b.at)
  if (!DAY2) return { requests, widenings }
  const again = (id: string) => `${id}#2`
  return {
    requests: [...requests, ...requests.map((req) => ({ ...req, id: again(req.id), at: req.at + DAY }))],
    widenings: [...widenings, ...widenings.map((event) => ({ ...event, at: event.at + DAY }))],
  }
}

interface Scenario {
  name: string
  learn: boolean
  hand: boolean
  suggestions: boolean
}

const SCENARIOS: Scenario[] = [
  { name: "A  exact only", learn: false, hand: false, suggestions: false },
  { name: "B  exact + widenings made", learn: false, hand: true, suggestions: false },
  { name: "C  0.11: exact + learned reads", learn: true, hand: false, suggestions: false },
  { name: "D  0.11: C + widenings made", learn: true, hand: true, suggestions: false },
  { name: "E  0.11: C + every suggestion accepted", learn: true, hand: false, suggestions: true },
]

interface Stats {
  asked: number
  auto: number
  dangerous: number
  learned: number
  widened: number
  accepted: number
  blockers: Map<string, number>
}

const scored = (req: Req) => !DAY2 || req.id.endsWith("#2")

function replay(ledger: { requests: Req[]; widenings: Event[] }, scenario: Scenario, stats: Stats): void {
  const fold = {
    expireMs: SETTINGS.expireDays * DAY,
    ...(scenario.learn ? { threshold: SETTINGS.threshold } : {}),
  }
  const state = emptyState()
  const widenings = scenario.hand ? [...ledger.widenings] : []
  for (const original of ledger.requests) {
    const req = original
    while (widenings.length > 0 && (widenings[0] as Event).at <= req.at)
      apply(state, widenings.shift() as Event, fold)
    if (req.permission === "external_directory" || req.items.length === 0) continue
    const counted = scored(req)
    if (counted) stats.asked++
    const parts = req.items.map((item) => {
      if (
        standing(state.entries.get(keyOf(req.permission, item.subject)), item.danger, SETTINGS, req.at)
          .trusted
      )
        return { item, ok: true }
      const through = item.danger
        ? undefined
        : widenedFor(state, req.permission, item.subject, SETTINGS, req.at)
      return { item, ok: through !== undefined, via: through?.family, learned: through?.learned }
    })
    const base = {
      v: 1 as const,
      at: req.at,
      request: req.id,
      session: "replay",
      permission: req.permission,
      agent: req.agent,
    }
    if (parts.every((part) => part.ok)) {
      if (counted) {
        stats.auto++
        if (parts.some((part) => part.item.danger)) stats.dangerous++
        if (parts.some((part) => part.learned)) stats.learned++
        if (parts.some((part) => part.via !== undefined && !part.learned)) stats.widened++
      }
      const items = parts.map((part) => ({
        subject: part.item.subject,
        ...(part.via ? { via: part.via } : {}),
      }))
      apply(state, { ...base, type: "auto", rule: "replay", items }, fold)
      continue
    }
    if (counted)
      for (const part of parts)
        if (!part.ok)
          stats.blockers.set(
            blocker(req.permission, part.item),
            (stats.blockers.get(blocker(req.permission, part.item)) ?? 0) + 1,
          )
    if (req.outcome) apply(state, { ...base, type: req.outcome, items: req.items }, fold)
    if (scenario.suggestions) {
      const reading = { state, settings: SETTINGS, now: req.at }
      for (const suggestion of suggestionsOf(reading, familiesOf(reading, commandsOf(reading)))) {
        apply(
          state,
          {
            v: 1,
            at: req.at,
            type: "widened",
            permission: suggestion.family.permission,
            agent: suggestion.agent,
            family: suggestion.family.family,
          },
          fold,
        )
        if (counted) stats.accepted++
      }
    }
  }
}

/** `program · reason`, the program only when it is named like one — never an argument. */
function blocker(permission: string, item: Item): string {
  if (permission !== "bash") return `${permission} · exact only`
  const program = (readSubject(item.subject)?.command.argv[0] ?? "").replace(/^.*\//, "")
  const name = /^[a-z][a-z0-9_.+-]{0,30}$/.test(program) ? program : "‹other›"
  if (item.danger) return `${name} · dangerous (${item.danger})`
  const why = notReadSubject(permission, item.subject)
  if (why === undefined) return `${name} · a read, family not learned yet`
  if (/ is not a known read$/.test(why)) return `${name} · not in the read list`
  if (/^git \S* ?is not a read$/.test(why)) return `${name} · a git subcommand that is not a read`
  if (/may hold secrets$/.test(why)) return `${name} · names a secret file`
  if (/^-|^--/.test(why) || /writes|rewrites|downloads|extracts|is written/.test(why))
    return `${name} · writes a file`
  return `${name} · ${why.replace(/[`'"].*$/, "").replace(/\S*[/.]\S*/g, "…")}`
}

const ledgers = (files.length > 0 ? files : localLedgers()).map(readLedger)
if (ledgers.length === 0) {
  process.stderr.write("No ledgers found. Pass one: run.ts <events.ndjson>\n")
  process.exit(1)
}

const pct = (a: number, b: number) => (b === 0 ? "–" : `${((100 * a) / b).toFixed(1)}%`)
const results = SCENARIOS.map((scenario) => {
  const stats: Stats = {
    asked: 0,
    auto: 0,
    dangerous: 0,
    learned: 0,
    widened: 0,
    accepted: 0,
    blockers: new Map(),
  }
  for (const ledger of ledgers) replay(ledger, scenario, stats)
  return { scenario, stats }
})

console.log(
  `${ledgers.length} ledger(s), ${results[0]?.stats.asked} requests scored${DAY2 ? " (day 2)" : ""}\n`,
)
console.log(
  "scenario                                    answered      %   learned  widened  dangerous  suggestions",
)
for (const { scenario, stats } of results)
  console.log(
    `${scenario.name.padEnd(42)} ${String(stats.auto).padStart(8)} ${pct(stats.auto, stats.asked).padStart(6)} ${String(stats.learned).padStart(9)} ${String(stats.widened).padStart(8)} ${String(stats.dangerous).padStart(10)} ${String(stats.accepted).padStart(12)}`,
  )
for (const { scenario, stats } of results.filter(
  (each) => each.scenario.name.startsWith("C") || each.scenario.name.startsWith("E"),
)) {
  console.log(`\nleft to you under "${scenario.name.slice(3)}" — parts, by program · reason:`)
  for (const [why, count] of [...stats.blockers].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`  ${String(count).padStart(4)}  ${why}`)
}
