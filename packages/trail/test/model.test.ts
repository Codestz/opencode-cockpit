import { describe, expect, test } from "bun:test"
import {
  arrange,
  conversationThings,
  foundIn,
  type Line,
  linesOf,
  matches,
  notRecorded,
  projectThings,
} from "../src/core/model.ts"
import { SAMPLE_NOW, SAMPLE_SESSION, SAMPLES } from "../src/core/sample.ts"
import { emptyState, type State } from "../src/core/store.ts"
import { runAdd } from "../src/core/tools.ts"

let at = 0
function trail(adds: { [key: string]: string }[], session = "s1", state: State = emptyState()): State {
  for (const args of adds) {
    const out = runAdd(state, args, { session, rootSession: session, by: "agent", at: ++at * 60_000 })
    if (!out.ok) throw new Error(out.text)
  }
  return state
}

const names = (lines: Line[]) =>
  lines.map((line) =>
    line.kind === "head"
      ? `# ${line.name}`
      : `${"  ".repeat(line.depth)}${line.thing.label ?? line.thing.title}`,
  )

describe("order: by the work, not by the tool", () => {
  test("a ticket heads its PRs, newest first inside; groups come before things that stand alone", () => {
    const state = trail([
      { title: "Deploy", ref: "deploy-1", kind: "deploy" },
      { title: "Bundle desync", url: "https://acme.atlassian.net/browse/COM-1736" },
      { title: "Older PR", url: "https://github.com/a/b/pull/12", for: "COM-1736" },
      { title: "Newer PR", url: "https://github.com/a/b/pull/33", for: "COM-1736" },
      { title: "Page", url: "https://acme.atlassian.net/wiki/x/1" },
    ])
    expect(names(linesOf(arrange(conversationThings(state, "s1"))))).toEqual([
      "COM-1736",
      "  PR #33",
      "  PR #12",
      "Page",
      "deploy-1",
    ])
  })

  test("`for` may be the ticket's link, and a ticket nothing records heads its group by name", () => {
    const state = trail([
      { title: "A", url: "https://github.com/a/b/pull/1", for: "https://acme.atlassian.net/browse/COM-9" },
      { title: "B", ref: "abc123", kind: "commit", for: "com-9" },
    ])
    const lines = linesOf(arrange(conversationThings(state, "s1")))
    expect(names(lines)).toEqual(["# COM-9", "  abc123", "  PR #1"])
  })

  test("a chain is one group under its top; a loop draws every thing once", () => {
    const chain = trail([
      { title: "Epic", ref: "EPIC-1" },
      { title: "Story", ref: "ST-1", for: "EPIC-1" },
      { title: "PR", url: "https://github.com/a/b/pull/2", for: "ST-1" },
    ])
    expect(names(linesOf(arrange(conversationThings(chain, "s1"))))).toEqual(["EPIC-1", "  PR #2", "  ST-1"])
    const loop = trail([
      { title: "One", ref: "L-1", for: "L-2" },
      { title: "Two", ref: "L-2", for: "L-1" },
    ])
    expect(names(linesOf(arrange(conversationThings(loop, "s1"))))).toEqual(["L-1", "  L-2"])
  })

  test("the busy sample, as the design sketches it", () => {
    const { state, session } = (SAMPLES.busy as () => { state: State; session: string })()
    const lines = names(linesOf(arrange(conversationThings(state, session))))
    expect(lines.slice(0, 6)).toEqual([
      "# COM-1801",
      "  a1b2c3d",
      "  ENG-42",
      "COM-1736",
      "  PR #33",
      "  PR #12",
    ])
  })
})

describe("search", () => {
  const state = trail([
    { title: "Release notes for 0.8", url: "https://acme.atlassian.net/wiki/x/1", kind: "page" },
    { title: "Fix desync", url: "https://github.com/a/b/pull/33", for: "COM-1736" },
    { title: "Bundle desync", url: "https://acme.atlassian.net/browse/COM-1736" },
  ])
  const things = conversationThings(state, "s1")
  const found = (query: string) => things.filter((thing) => matches(thing, query)).map((thing) => thing.title)

  test("over title, ref, kind and system — every word, case-blind", () => {
    expect(found("release")).toEqual(["Release notes for 0.8"])
    expect(found("a/b#33")).toEqual(["Fix desync"])
    expect(found("PAGE")).toEqual(["Release notes for 0.8"])
    expect(found("confluence")).toEqual(["Release notes for 0.8"])
    expect(found("desync jira")).toEqual(["Bundle desync"])
    expect(found("")).toHaveLength(3)
  })

  test("a query keeps a group's head as context, and counts only what matched", () => {
    const arranged = arrange(things, "github")
    expect(names(linesOf(arranged))).toEqual(["COM-1736", "  PR #33"])
    expect(arranged.shown).toBe(1)
    expect(arranged.total).toBe(3)
  })
})

describe("All conversations", () => {
  test("one row per link, every conversation that touched it, the latest first", () => {
    const state = trail([{ title: "PR", url: "https://github.com/a/b/pull/1" }], "s1")
    trail(
      [{ title: "PR, reviewed", url: "https://github.com/a/b/pull/1/files", action: "reviewed" }],
      "s2",
      state,
    )
    trail([{ title: "Other", ref: "X-1" }], "s2", state)
    const things = projectThings(state)
    expect(things).toHaveLength(2)
    const pr = things.find((thing) => thing.label === "PR #1")
    expect(pr?.touches.map((touch) => touch.session)).toEqual(["s2", "s1"])
    expect(pr?.title).toBe("PR, reviewed")
    expect(pr?.history.map((step) => step.action)).toEqual(["created", "reviewed"])
  })

  test("a deleted conversation's touch is marked, and keeps its title", () => {
    const { state } = (SAMPLES.project as () => { state: State })()
    const gone = projectThings(state).find((thing) => thing.title === "Old dashboard")
    expect(gone?.touches[0]).toMatchObject({ deleted: true, title: "Set up the latency dashboard" })
  })
})

describe("seen in output, not recorded", () => {
  test("links in output minus what this conversation recorded, by link or derived ref", () => {
    const state = trail([
      { title: "Recorded", url: "https://github.com/a/b/pull/1" },
      { title: "By ref", ref: "a/b#2" },
    ])
    const seen = [
      ...foundIn("https://github.com/a/b/pull/1/files https://github.com/a/b/pull/2", 10),
      ...foundIn("Created https://github.com/a/b/pull/3.", 20),
      ...foundIn("again https://github.com/a/b/pull/3", 30),
    ]
    expect(notRecorded(state, "s1", seen).map((each) => [each.url, each.at])).toEqual([
      ["https://github.com/a/b/pull/3", 20],
    ])
    expect(notRecorded(state, "s9", seen)).toHaveLength(3)
  })

  test("a find knows its link and the ref it derives", () => {
    expect(foundIn("https://acme.atlassian.net/browse/COM-9", SAMPLE_NOW)).toEqual([
      { url: "https://acme.atlassian.net/browse/COM-9", ref: "COM-9", at: SAMPLE_NOW },
    ])
    expect(SAMPLE_SESSION).toBe("ses_main")
  })
})
