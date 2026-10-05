#!/usr/bin/env bun
/**
 * Scores every family rule in `strategies.ts`:
 *
 * 1. on the labelled pairs (`corpus.ts`, all made up): a `separate` pair given one family is a safety
 *    miss; a `together` pair split is a usefulness miss;
 * 2. on the Trust ledgers on this machine, as counts only — how many families each rule makes, how
 *    big, and how many mix commands that name different environments. No command from a ledger is
 *    printed or written anywhere.
 *
 *   bun packages/trust/experiments/families/run.ts            the summary
 *   bun packages/trust/experiments/families/run.ts --json     the same, as JSON (for the results page)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { readSubject } from "../../src/core/family.ts"
import { parseLines } from "../../src/core/ledger.ts"
import { type Command, parse } from "../../src/core/shell.ts"
import { CORPUS_COMMANDS, PAIRS, type Pair } from "./corpus.ts"
import { envWords, historyOf, STRATEGIES } from "./strategies.ts"

const one = (line: string): Command => {
  const read = parse(line)
  if (read.kind !== "commands" || read.commands.length !== 1) throw new Error(`not one command: ${line}`)
  return read.commands[0] as Command
}

/** Every bash command in this machine's Trust ledgers, once each. */
function localCommands(): Command[] {
  const base = join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "opencode-cockpit",
    "trust",
  )
  if (!existsSync(base)) return []
  const subjects = new Set<string>()
  for (const dir of readdirSync(base)) {
    const file = join(base, dir, "events.ndjson")
    if (!existsSync(file)) continue
    for (const event of parseLines(`${readFileSync(file, "utf8")}\n`).events) {
      if (!("items" in event) || event.permission !== "bash") continue
      for (const item of event.items) subjects.add(item.subject)
    }
  }
  return [...subjects].flatMap((subject) => {
    const read = readSubject(subject)
    return read ? [read.command] : []
  })
}

const corpus = CORPUS_COMMANDS.map(one)
const local = localCommands()
const history = historyOf([...corpus, ...local])

interface Result {
  id: string
  name: string
  describe: string
  safetyMisses: { pair: Pair; family: string }[]
  splits: { pair: Pair; a: string; b: string }[]
  separateTotal: number
  togetherTotal: number
  local: { commands: number; families: number; singletons: number; largest: number; envMixed: number }
}

const results: Result[] = STRATEGIES.map((strategy) => {
  const family = (command: Command) => strategy.family(command, history)
  const safetyMisses: Result["safetyMisses"] = []
  const splits: Result["splits"] = []
  for (const pair of PAIRS) {
    const a = family(one(pair.a))
    const b = family(one(pair.b))
    if (pair.want === "separate" && a === b) safetyMisses.push({ pair, family: a })
    if (pair.want === "together" && a !== b) splits.push({ pair, a, b })
  }
  const groups = new Map<string, Command[]>()
  for (const command of local) {
    const key = family(command)
    groups.set(key, [...(groups.get(key) ?? []), command])
  }
  const sizes = [...groups.values()].map((group) => group.length)
  /** A family whose commands name different environments (or one names one and another none). */
  const envMixed = [...groups.values()].filter((group) => {
    const kinds = new Set(
      group.map((command) =>
        envWords([...command.env, ...command.argv].join(" "))
          /** `test` is left out, as the rules leave it out: it is mostly a file name (`a.test.ts`). */
          .filter((word) => word !== "test" && word !== "testing")
          .sort()
          .join(","),
      ),
    )
    return kinds.size > 1
  }).length
  return {
    id: strategy.id,
    name: strategy.name,
    describe: strategy.describe,
    safetyMisses,
    splits,
    separateTotal: PAIRS.filter((pair) => pair.want === "separate").length,
    togetherTotal: PAIRS.filter((pair) => pair.want === "together").length,
    local: {
      commands: local.length,
      families: groups.size,
      singletons: sizes.filter((size) => size === 1).length,
      largest: Math.max(0, ...sizes),
      envMixed,
    },
  }
})

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} else {
  console.log(
    `corpus: ${PAIRS.length} pairs · this machine: ${local.length} distinct commands (counts only)\n`,
  )
  for (const result of results) {
    const { local: l } = result
    console.log(
      `${result.id.padEnd(3)} ${result.name.padEnd(36)} safety misses ${String(result.safetyMisses.length).padStart(2)}/${result.separateTotal}` +
        `  splits ${String(result.splits.length).padStart(2)}/${result.togetherTotal}` +
        `  | local: ${l.families} families, ${l.singletons} of one, largest ${l.largest}, env-mixed ${l.envMixed}`,
    )
    for (const miss of result.safetyMisses) console.log(`      ✗ merged (${miss.pair.why}): ${miss.family}`)
  }
}
