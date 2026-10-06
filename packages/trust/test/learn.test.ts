/**
 * Families of reads Trust learns by itself (0.11): `threshold` approved reads in a row in one family,
 * any file, and the family answers plain reads — never a write, a secret file, an env var or a wrapper.
 * Plus #44: a family a person widened no longer covers the flags that make a program write.
 */
import { describe, expect, test } from "bun:test"
import { createEngine } from "../src/core/engine.ts"
import { covers, familyOf, outside } from "../src/core/family.ts"
import type { Request } from "../src/core/keys.ts"
import { applyAll, DAY, type Event, emptyState, keyOf, live, type State } from "../src/core/ledger.ts"
import { decide } from "../src/core/policy.ts"
import { rulesFrom } from "../src/core/rules.ts"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"

const ROOT = "/work/app"
const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
const FOLD = { expireMs: 30 * DAY, threshold: 3 }
const OPEN = rulesFrom({ permission: { bash: "ask" } })

/** A line's subjects, as Trust stores them. */
const subjects = (line: string): string[] => {
  const parsed = parse(line)
  if (parsed.kind !== "commands") throw new Error(`opaque: ${line}`)
  return parsed.commands.map((command) => signature(command, ROOT))
}
const sub = (line: string) => subjects(line)[0] as string

let n = 0
function ev(
  type: "approved" | "rejected" | "auto",
  line: string,
  at: number,
  more: { agent?: string; danger?: string; via?: string } = {},
): Event {
  n++
  return {
    v: 1,
    at,
    type,
    request: `per_${n}`,
    session: "ses_1",
    permission: "bash",
    agent: more.agent ?? "build",
    items: subjects(line).map((subject) => ({
      subject,
      ...(more.danger ? { danger: more.danger } : {}),
      ...(more.via ? { via: more.via } : {}),
    })),
    ...(type === "auto" ? { rule: "trusted" } : {}),
  } as Event
}
const approve = (line: string, at: number, more: { agent?: string; danger?: string } = {}) =>
  ev("approved", line, at, more)

const learned = (state: State, family: string) => state.widened.get(keyOf("bash", family))
const streakOf = (state: State, family: string) => state.reads.get(keyOf("bash", family))?.streak ?? 0

const THREE_HEADS = [approve("head -3 a.ts", 1), approve("head -3 b.ts", 2), approve("head -40 c.md", 3)]

describe("learning a family of reads in the ledger", () => {
  test("three approved reads of three files teach the family", () => {
    const state = applyAll(emptyState(), THREE_HEADS, FOLD)
    expect(learned(state, "head")).toMatchObject({ learned: true, family: "head", agent: "build", at: 3 })
  })

  test("without a threshold in the fold nothing is learned (learnReads: false)", () => {
    const state = applyAll(emptyState(), THREE_HEADS, { expireMs: 30 * DAY })
    expect(learned(state, "head")).toBeUndefined()
    expect(state.reads.size).toBe(0)
  })

  test("two of a family in one request count once", () => {
    const state = applyAll(emptyState(), [approve("head a | head b", 1)], FOLD)
    expect(streakOf(state, "head")).toBe(1)
  })

  test("a read counts even after a part of its family that is not one: head .env | head a", () => {
    const state = applyAll(emptyState(), [approve("head .env | head a", 1)], FOLD)
    expect(streakOf(state, "head")).toBe(1)
  })

  test("what is not a read never counts: a secret file, a redirection, an env var", () => {
    const state = applyAll(
      emptyState(),
      [approve("head .env", 1), approve("head a > out.txt", 2), approve("FOO=1 head a", 3)],
      FOLD,
    )
    expect(streakOf(state, "head")).toBe(0)
    expect(learned(state, "head")).toBeUndefined()
  })

  test("a dangerous item never counts", () => {
    const state = applyAll(emptyState(), [approve("head a", 1, { danger: "production" })], FOLD)
    expect(streakOf(state, "head")).toBe(0)
  })

  test("a reject of a read in the family takes the learned family away and starts over", () => {
    const state = applyAll(emptyState(), [...THREE_HEADS, ev("rejected", "head -5 d.ts", 4)], FOLD)
    expect(learned(state, "head")).toBeUndefined()
    expect(streakOf(state, "head")).toBe(0)
  })

  test("a reject of something it never covers leaves it: head .env", () => {
    const state = applyAll(emptyState(), [...THREE_HEADS, ev("rejected", "head .env", 4)], FOLD)
    expect(learned(state, "head")?.learned).toBe(true)
    expect(streakOf(state, "head")).toBe(3)
  })

  test("`w` on a learned family forgets it, and it is never suggested again", () => {
    const state = applyAll(
      emptyState(),
      [
        ...THREE_HEADS,
        { v: 1, at: 4, type: "unwidened", permission: "bash", agent: "build", family: "head" },
      ],
      FOLD,
    )
    expect(learned(state, "head")).toBeUndefined()
    expect(streakOf(state, "head")).toBe(0)
    expect(state.dismissed.has(keyOf("bash", "head"))).toBe(true)
  })

  test("unused past expiry, a learned family is gone and the next read starts again from one", () => {
    const later = 3 + 31 * DAY
    const state = applyAll(emptyState(), [...THREE_HEADS, approve("head -9 e.ts", later)], FOLD)
    expect(learned(state, "head")).toBeUndefined()
    expect(streakOf(state, "head")).toBe(1)
  })

  test("an answer through the learned family keeps it alive", () => {
    const at = 3 + 20 * DAY
    const state = applyAll(
      emptyState(),
      [...THREE_HEADS, ev("auto", "head -1 x.ts", at, { via: "head" })],
      FOLD,
    )
    expect(learned(state, "head")?.lastAt).toBe(at)
  })

  test("a family a person widened is never replaced by a learned one", () => {
    const widened: Event = {
      v: 1,
      at: 0,
      type: "widened",
      permission: "bash",
      agent: "build",
      family: "head",
    }
    const state = applyAll(emptyState(), [widened, ...THREE_HEADS], FOLD)
    expect(learned(state, "head")?.learned).toBeUndefined()
  })

  test("learning is the project's: reads approved while different agents ran add up", () => {
    const state = applyAll(
      emptyState(),
      [approve("head a", 1), approve("head b", 2, { agent: "general" }), approve("head c", 3)],
      FOLD,
    )
    expect(streakOf(state, "head")).toBe(3)
    expect(learned(state, "head")?.learned).toBe(true)
  })

  test("live: a person's widening always, a learned one until unused past expireDays", () => {
    const state = applyAll(emptyState(), THREE_HEADS, FOLD)
    const found = learned(state, "head")
    if (!found) throw new Error("not learned")
    expect(live(found, SETTINGS, 3 + 29 * DAY)).toBe(true)
    expect(live(found, SETTINGS, 3 + 31 * DAY)).toBe(false)
    expect(live(found, { ...SETTINGS, expireDays: 0 }, 3 + 365 * DAY)).toBe(true)
    expect(live({ ...found, learned: undefined } as never, SETTINGS, 3 + 365 * DAY)).toBe(true)
  })
})

let r = 0
function ask(line: string, events: readonly Event[], options: { agent?: string; now?: number } = {}) {
  r++
  const request: Request = {
    id: `ask_${r}`,
    sessionID: "ses_1",
    permission: "bash",
    patterns: [line],
    always: [],
  }
  return decide({
    request,
    context: { line, root: ROOT },
    agent: options.agent ?? "build",
    rules: OPEN,
    state: applyAll(emptyState(), events, FOLD),
    settings: SETTINGS,
    now: options.now ?? 10,
  })
}

describe("answering through a learned family", () => {
  test("a plain read of a file never seen is answered, and says it was learned", () => {
    const judgement = ask("head -20 src/new.ts", THREE_HEADS)
    expect(judgement.answer).toBe(true)
    expect(judgement.why).toContain("learned")
    expect(judgement.items).toEqual([{ subject: "head -20 src/new.ts", via: "head", learned: true }])
  })

  for (const line of ["head .env", "head a > out.txt", "FOO=1 head a", "sudo head a"])
    test(`${line} still asks`, () => expect(ask(line, THREE_HEADS).answer).toBe(false))

  test("every part is checked: head -c 5 x | head .env asks", () => {
    const judgement = ask("head -c 5 x | head .env", THREE_HEADS)
    expect(judgement.answer).toBe(false)
    expect(judgement.progress.map((each) => each.trusted)).toEqual([true, false])
  })

  test("another agent is answered too: it is the project's", () =>
    expect(ask("head x", THREE_HEADS, { agent: "general" }).answer).toBe(true))

  test("unused past expireDays it stops answering", () =>
    expect(ask("head x", THREE_HEADS, { now: 3 + 31 * DAY }).answer).toBe(false))

  test("an engine with learnReads: false learns nothing", () => {
    const engine = createEngine({ ...SETTINGS, learnReads: false })
    engine.load(THREE_HEADS)
    expect(engine.state.widened.size).toBe(0)
    const on = createEngine(SETTINGS)
    on.load(THREE_HEADS)
    expect(on.state.widened.size).toBe(1)
  })
})

describe("#44: a widened family does not cover the flags that make it write", () => {
  test("a widened sed does not cover sed -i", () => {
    expect(familyOf("bash", sub("sed -i s/a/b/ f.ts"))).toBe("sed")
    expect(outside("bash", sub("sed -i s/a/b/ f.ts"))).toContain("writes to a file")
    expect(covers("bash", "sed", sub("sed -i s/a/b/ f.ts"))).toBe(false)
    expect(covers("bash", "sed", sub("sed -n 1,5p f.ts"))).toBe(true)
  })

  test("a widened sort does not cover sort -o", () => {
    expect(covers("bash", "sort", sub("sort -o out.txt in.txt"))).toBe(false)
    expect(covers("bash", "sort", sub("sort -rn in.txt"))).toBe(true)
  })

  test("a widened rg does not cover rg --pre", () =>
    expect(outside("bash", sub("rg --pre ./x.sh foo"))).toBe("it runs another program"))

  test("decide: widened sed answers sed -n, asks for sed -i", () => {
    const widened: Event = { v: 1, at: 0, type: "widened", permission: "bash", agent: "build", family: "sed" }
    expect(ask("sed -n 1,5p f.ts", [widened]).answer).toBe(true)
    expect(ask("sed -i s/a/b/ f.ts", [widened]).answer).toBe(false)
  })
})
