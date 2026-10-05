import { describe, expect, test } from "bun:test"
import { PAIRS } from "../experiments/families/corpus.ts"
import { familyOf } from "../src/core/family.ts"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"

/**
 * The labelled pairs from the experiment that chose this rule (experiments/families): made-up commands,
 * each pair either one that must stay two families (dev and prod, a read and a write) or one that may
 * share a family. A merge is a widening that trusts more than it says; a split only costs approvals.
 */
const family = (line: string) => {
  const read = parse(line)
  if (read.kind !== "commands") throw new Error(line)
  return familyOf("bash", signature(read.commands[0] as never))
}

describe("where a family ends, on the experiment's pairs", () => {
  for (const pair of PAIRS.filter((each) => each.want === "separate"))
    test(`two families: ${pair.a}  ≠  ${pair.b}  (${pair.why})`, () => {
      expect(family(pair.a)).not.toBe(family(pair.b))
    })

  /** What the rule knowingly splits: the third plain word is a service's name here. */
  const SPLIT = new Set(["docker compose -p dev logs web"])
  for (const pair of PAIRS.filter((each) => each.want === "together" && !SPLIT.has(each.a)))
    test(`one family: ${pair.a}  =  ${pair.b}  (${pair.why})`, () => {
      expect(family(pair.a)).toBe(family(pair.b))
    })
})
