import { describe, expect, test } from "bun:test"
import { arrange, conversationThings, foundIn, notRecorded, projectThings } from "../src/core/model.ts"
import { SAMPLE_NOW, SAMPLES, type Sample } from "../src/core/sample.ts"
import { emptyState } from "../src/core/store.ts"
import {
  ADD_DESCRIPTION,
  GUIDANCE,
  LIST_DESCRIPTION,
  listText,
  markdownOf,
  PRODUCED_LIMIT,
  producedLine,
  seenLine,
} from "../src/core/text.ts"
import { runAdd, runList } from "../src/core/tools.ts"
import { dialogRows } from "../src/core/view/dialog.ts"

const sample = (name: string) => (SAMPLES[name] as () => Sample)()
const who = { session: "s1", rootSession: "s1", by: "agent" as const, at: SAMPLE_NOW }

describe("what the model is told", () => {
  test("the tool says when to call it within what OpenCode 2's catalog shows (~115 characters)", () => {
    const shown = ADD_DESCRIPTION.slice(0, 112)
    expect(shown).toContain("right after you create or change something outside this repo")
    expect(shown).toContain("PR")
    expect(shown).toContain("ticket")
    expect(LIST_DESCRIPTION.slice(0, 112)).toContain("trail_add")
  })

  test("the guidance names tools.trail_add and carries two examples", () => {
    expect(GUIDANCE.startsWith("## Trail")).toBe(true)
    expect(GUIDANCE).toContain("tools.trail_add")
    expect(GUIDANCE.match(/tools\.trail_add\(\{ title: /g)).toHaveLength(2)
    expect(GUIDANCE).toContain("Not for files in this repository")
  })

  test("the rule itself says to group with for, to list before answering, and who records a subagent's work", () => {
    expect(GUIDANCE).toContain("put its key in `for` so the record groups under it")
    expect(GUIDANCE).toContain("Before saying what this work produced, call trail_list")
    expect(GUIDANCE).toContain("A subagent records what it makes itself")
  })
})

describe("trail_add answers", () => {
  test("a new record: what it is, what was done, how many now", () => {
    const state = emptyState()
    const out = runAdd(state, { title: "Fix desync", url: "https://github.com/a/b/pull/1" }, who)
    expect(out.ok).toBe(true)
    expect(out.text).toContain('Recorded PR #1 "Fix desync" (GitHub) — created.')
    expect(out.text).toContain("holds 1 thing")
  })

  test("the same url again: the existing record, its history, and that no row was added", () => {
    const state = emptyState()
    runAdd(state, { title: "Draft", url: "https://github.com/a/b/pull/1" }, who)
    const out = runAdd(
      state,
      { title: "Fix desync", url: "https://github.com/a/b/pull/1" },
      { ...who, at: who.at + 1 },
    )
    expect(out.text).toContain(
      'Updated the existing record of PR #1 "Fix desync" (GitHub): created → updated.',
    )
    expect(out.text).toContain("never makes a second row")
    expect(out.text).toContain("holds 1 thing")
  })

  test("a stripped secret and a `for` not in the trail are both said", () => {
    const out = runAdd(
      emptyState(),
      { title: "Report", url: "https://r.acme.dev/x?token=abc", for: "COM-1" },
      who,
    )
    expect(out.text).toContain("looked like a secret: token")
    expect(out.text).toContain('"COM-1" is not in this conversation\'s trail itself')
    if (out.ok) expect(out.event).toMatchObject({ type: "recorded", url: "https://r.acme.dev/x" })
  })

  test("a refusal writes nothing and says how to recover", () => {
    const state = emptyState()
    const out = runAdd(state, { url: "https://github.com/a/b/pull/1" }, who)
    expect(out.ok).toBe(false)
    expect(out.text).toContain("Nothing was recorded")
    expect(state.records.size).toBe(0)
  })
})

describe("trail_list answers", () => {
  test("empty: says so and what to do", () => {
    expect(runList(emptyState(), {}, "s1", SAMPLE_NOW)).toContain("record it with trail_add")
    expect(runList(emptyState(), { all: true }, "s1", SAMPLE_NOW)).toContain(
      "Nothing is in the trail for this project",
    )
  })

  test("the same facts, in the same order, as the dialog draws (one truth)", () => {
    const { state, session, found } = sample("busy")
    const text = listText({ state, session, all: false, query: "", now: SAMPLE_NOW })
    const view = dialogRows({
      width: 200,
      height: 60,
      tab: "this",
      state,
      session,
      found,
      now: SAMPLE_NOW,
      project: "p",
    })
    const dialogOrder = view.items.flatMap((item) => (item.kind === "thing" ? [item.thing.title] : []))
    const listOrder = [...text.matchAll(/^\s*- (?:[^"\n]* )?"([^"]+)"/gm)].map((match) => match[1])
    expect(listOrder).toEqual(dialogOrder)
    expect(text).toContain("9 things in this conversation, grouped by what they are for, newest work first:")
    expect(text).toContain("- COM-1801 (not recorded itself)")
    expect(text).toContain("created → updated 1h ago")
    expect(text).toContain("by subagent docs")
    expect(text).toContain("added by you")
    expect(text).toContain("note: behind the flag")
  })

  test("a query that finds nothing says what was searched and what to try", () => {
    const { state, session } = sample("busy")
    const text = runList(state, { query: "kubernetes" }, session, SAMPLE_NOW)
    expect(text).toContain('Nothing in this conversation matches "kubernetes"')
    expect(text).toContain("all: true")
    expect(runList(state, { query: "jira" }, session, SAMPLE_NOW)).toMatch(
      /^1 of 9 things in this conversation/,
    )
  })

  test("all: every conversation that touched a thing, with its session id, a deleted one marked", () => {
    const { state, session } = sample("project")
    const text = runList(state, { all: true }, session, SAMPLE_NOW)
    expect(text).toContain('in "Review the 0.8 branch" (ses_review) — reviewed 20m ago')
    expect(text).toContain(
      'in "Fix the bundle desync" (ses_main) — created → updated 1h ago — this conversation',
    )
    expect(text).toContain('in "Set up the latency dashboard" (ses_gone, deleted)')
  })
})

describe("the lines on every request", () => {
  test("produced: nothing when nothing is recorded; else the things, capped, pointing at trail_list", () => {
    expect(producedLine(emptyState(), "s1")).toBeUndefined()
    const { state, session } = sample("busy")
    const line = producedLine(state, session) as string
    expect(line.startsWith("Trail — this conversation produced: ")).toBe(true)
    expect(line).toContain('PR #33 "0.8: Trust, one design system, and the sidebar or…" (created → updated)')
    expect(line).toContain(`+ ${9 - PRODUCED_LIMIT} more (trail_list)`)
  })

  test("seen: worded as a choice, recorded links left out", () => {
    const { state, session, found } = sample("busy")
    const line = seenLine(notRecorded(state, session, found)) as string
    expect(line).toBe(
      "Seen in output — record it with tools.trail_add if you created or changed it: https://github.com/acme/web/pull/40, https://acme.atlassian.net/browse/COM-1800",
    )
    expect(line).not.toContain("pull/33")
    expect(seenLine([])).toBeUndefined()
    const many = foundIn(Array.from({ length: 8 }, (_, i) => `https://github.com/a/b/pull/${i}`).join(" "), 1)
    expect(seenLine(many)).toEndWith("(+ 3 more)")
  })
})

describe("copy as markdown", () => {
  test("a nested list, links where there are links, titles escaped", () => {
    const state = emptyState()
    runAdd(state, { title: "Bundle desync", url: "https://acme.atlassian.net/browse/COM-1" }, who)
    runAdd(
      state,
      { title: "Fix [the] desync", url: "https://github.com/a/b/pull/1", for: "COM-1" },
      { ...who, at: who.at + 1 },
    )
    runAdd(state, { title: "Commit", ref: "abc123" }, { ...who, at: who.at + 2 })
    expect(markdownOf(arrange(conversationThings(state, "s1")))).toBe(
      [
        "- [COM-1 — Bundle desync](https://acme.atlassian.net/browse/COM-1) · Jira · created",
        "  - [PR #1 — Fix \\[the\\] desync](https://github.com/a/b/pull/1) · GitHub · created",
        "- abc123 — Commit · created",
      ].join("\n"),
    )
  })

  test("a group headed by name is bold", () => {
    const { state } = sample("busy")
    expect(markdownOf(arrange(projectThings(state)))).toStartWith("- **COM-1801**\n  - a1b2c3d — Bump")
  })
})
