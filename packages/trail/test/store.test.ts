import { describe, expect, test } from "bun:test"
import {
  applyAll,
  type Event,
  emptyState,
  historyText,
  parseLines,
  type State,
  serialize,
  vanished,
} from "../src/core/store.ts"

let n = 0
function recorded(fields: Partial<Extract<Event, { type: "recorded" }>>, at = ++n * 1000): Event {
  return {
    v: 1,
    at,
    id: `e${++n}`,
    type: "recorded",
    rootSession: "ses_1",
    session: "ses_1",
    sessionTitle: "Fix the desync",
    by: "agent",
    title: "Thing",
    action: "created",
    ...fields,
  } as Event
}

const records = (state: State) => [...state.records.values()]
const PR = "https://github.com/a/b/pull/1"

describe("one thing, one record", () => {
  test("the same url again is the same record, its actions a history", () => {
    const state = applyAll(emptyState(), [
      recorded({ url: PR, title: "Draft" }),
      recorded({ url: `${PR}/files`, title: "Fix the desync", action: "updated" }),
      recorded({ url: PR, title: "Fix the desync", action: "updated" }),
    ])
    expect(records(state)).toHaveLength(1)
    const [record] = records(state)
    expect(record?.title).toBe("Fix the desync")
    expect(record?.history.map((step) => step.action)).toEqual(["created", "updated", "updated"])
    expect(historyText(record as NonNullable<typeof record>)).toBe("created → updated")
  })

  test("with no url, the same ref is the same record, case-blind", () => {
    const state = applyAll(emptyState(), [
      recorded({ ref: "COM-1736", title: "Bundle desync" }),
      recorded({ ref: "com-1736", url: "https://acme.atlassian.net/browse/COM-1736", action: "updated" }),
    ])
    expect(records(state)).toHaveLength(1)
    expect(records(state)[0]?.url).toBe("https://acme.atlassian.net/browse/COM-1736")
  })

  test("what a later mention leaves out is kept", () => {
    const state = applyAll(emptyState(), [
      recorded({ url: PR, kind: "pull request", for: "COM-1", note: "first" }),
      recorded({ url: PR, title: "Better", action: "merged" }),
    ])
    expect(records(state)[0]).toMatchObject({
      title: "Better",
      kind: "pull request",
      for: "COM-1",
      note: "first",
    })
  })

  test("two conversations keep a record each", () => {
    const state = applyAll(emptyState(), [
      recorded({ url: PR }),
      recorded({ url: PR, rootSession: "ses_2", session: "ses_2", sessionTitle: "Review" }),
    ])
    expect(records(state).map((record) => record.session)).toEqual(["ses_1", "ses_2"])
    expect(state.conversations.get("ses_2")?.title).toBe("Review")
  })

  test("a subagent's record belongs to the conversation and remembers the subagent", () => {
    const state = applyAll(emptyState(), [recorded({ url: PR, session: "ses_child", subagent: "explore" })])
    expect(records(state)[0]).toMatchObject({ session: "ses_1", subagent: "explore" })
  })

  test("an event read twice is applied once", () => {
    const event = recorded({ url: PR })
    const state = applyAll(emptyState(), [event, event, recorded({ url: PR, action: "updated" })])
    expect(records(state)[0]?.history).toHaveLength(2)
  })

  test("removed takes the record out; recording it again starts a new one", () => {
    const first = recorded({ url: PR })
    const state = applyAll(emptyState(), [
      first,
      { v: 1, at: 99_000, id: "rm", type: "removed", rootSession: "ses_1", record: first.id },
    ])
    expect(records(state)).toHaveLength(0)
    applyAll(state, [recorded({ url: PR, action: "updated" })])
    expect(records(state)[0]?.history.map((step) => step.action)).toEqual(["updated"])
  })
})

describe("deleted conversations", () => {
  test("keep their records, marked, and their title", () => {
    const state = applyAll(emptyState(), [
      recorded({ url: PR, rootSession: "ses_gone", session: "ses_gone", sessionTitle: "Old work" }),
      { v: 1, at: 500_000, id: "del", type: "deleted", rootSession: "ses_gone" },
    ])
    expect(records(state)).toHaveLength(1)
    expect(state.conversations.get("ses_gone")).toMatchObject({ title: "Old work", deletedAt: 500_000 })
  })

  test("a conversation with records the host no longer lists has vanished", () => {
    const state = applyAll(emptyState(), [
      recorded({ url: PR }),
      recorded({ url: PR, rootSession: "ses_2", session: "ses_2" }),
    ])
    expect(vanished(state, new Set(["ses_1"])).map((each) => each.session)).toEqual(["ses_2"])
    applyAll(state, [{ v: 1, at: 1, id: "d2", type: "deleted", rootSession: "ses_2" }])
    expect(vanished(state, new Set(["ses_1"]))).toEqual([])
  })
})

describe("the file", () => {
  test("a line is one event, whatever a title holds", () => {
    const event = recorded({ url: PR, title: 'Line\nbreak "quoted"' })
    expect(serialize(event).split("\n")).toHaveLength(2)
    expect(parseLines(serialize(event)).events).toEqual([event])
  })

  test("a line cut short by a crash is skipped, and the event appended onto it recovered", () => {
    const a = recorded({ url: PR })
    const b = recorded({ ref: "X-1" })
    const torn = serialize(a).slice(0, 25) + serialize(b)
    expect(parseLines(torn).events).toEqual([b])
  })

  test("what follows the last newline is left for the next read", () => {
    const a = recorded({ url: PR })
    const { events, rest } = parseLines(`${serialize(a)}{"v":1,"at"`)
    expect(events).toEqual([a])
    expect(rest).toBe('{"v":1,"at"')
  })

  test("an event that is not one of ours is ignored", () => {
    const lines = [
      JSON.stringify({ v: 2, at: 1, id: "x", rootSession: "s", type: "recorded" }),
      JSON.stringify({
        v: 1,
        at: 1,
        id: "x",
        rootSession: "s",
        type: "recorded",
        session: "s",
        title: "t",
        action: "a",
        by: "agent",
      }),
      JSON.stringify({ v: 1, at: 1, id: "x", rootSession: "s", type: "moved" }),
      "not json",
      "",
    ].join("\n")
    expect(parseLines(`${lines}\n`).events).toEqual([])
  })
})
