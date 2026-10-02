import { describe, expect, test } from "bun:test"
import { slim } from "../src/agent/plugin.ts"
import { createV1Translator } from "../src/core/adapt/v1.ts"
import { createV2Translator } from "../src/core/adapt/v2.ts"
import type { Change } from "../src/core/model/changes.ts"
import {
  applyAll,
  callsOf,
  emptyModel,
  type Model,
  roundsOf,
  runTime,
  subagentsOf,
  titleOf,
} from "../src/core/model/model.ts"
import { CONTINUED_ROOT, continuedSample, SAMPLE_NOW } from "../src/core/sample.ts"
import { subagentAccount, subagentReport, waitReport } from "../src/core/view/report.ts"
import { elapsed, rowText } from "../src/core/view/rows.ts"
import { type ScreenInput, screenRows } from "../src/core/view/screen.ts"
import { dayClock, firstStarted, runPhrase, sidebarLines } from "../src/core/view/sidebar.ts"
import { recorded } from "./fixtures.ts"

/**
 * One truth (docs/building/principles.md, rule 2): what the sidebar and the pane draw of a subagent is
 * what the main agent's tools say of it — the same id, title, state, duration and number of calls.
 * The load test's "24h ago" and wrong task were the tool and the screen telling two stories.
 *
 * Each fixture goes through both: the interface's model (every change) and the agent side's (the
 * same changes, slimmed as the agent side keeps them).
 */

const NOW = Date.parse("2026-10-01T22:34:35Z")

/** Every state a run can be in, one subagent each. */
function states(): Change[] {
  const at = NOW - 10 * 60_000
  const run = (id: string, title: string, more: Change[]): Change[] => [
    { type: "session", id, parentID: "root", agent: id === "e" ? "explore" : "general", title, at },
    { type: "prompt", id, key: `${id}p`, text: `Do ${title}`, at },
    {
      type: "tool",
      id,
      call: `${id}1`,
      name: "read",
      state: "completed",
      input: { filePath: "/a/b.ts" },
      at,
    },
    ...more,
  ]
  return [
    ...run("a", "Answered", [
      { type: "reply", id: "a", key: "ar", text: "All done.", done: true, at: at + 1 },
      { type: "status", id: "a", status: "idle", at: at + 60_000 },
    ]),
    ...run("b", "Busy", [{ type: "status", id: "b", status: "busy", at }]),
    ...run("c", "Cancelled", [
      { type: "status", id: "c", status: "failed", error: "MessageAbortedError", at: at + 120_000 },
    ]),
    ...run("d", "Broken", [
      { type: "status", id: "d", status: "failed", error: "rate limited", at: at + 5_000 },
    ]),
    ...run("e", "Asking", [{ type: "status", id: "e", status: "waiting", at: at + 2_000 }]),
  ]
}

async function models(): Promise<{ name: string; ui: Model; agent: Model; root: string }[]> {
  const out = []
  for (const version of [1, 2] as const) {
    const { events, history } = await recorded(version)
    const translate = version === 1 ? createV1Translator() : createV2Translator()
    const changes = events.flatMap((line) => translate.event(line.event, line.at))
    out.push({
      name: `OpenCode ${version}'s recorded run`,
      ui: applyAll(emptyModel(), changes),
      agent: applyAll(emptyModel(), slim(changes)),
      root: history.parent as string,
    })
  }
  out.push({
    name: "every state",
    ui: applyAll(emptyModel(), states()),
    agent: applyAll(emptyModel(), slim(states())),
    root: "root",
  })
  return out
}

const pane = (ui: Model, root: string, id: string): string => {
  const nodes = subagentsOf(ui, root)
  const session = ui.sessions.get(id)
  if (!session) throw new Error(`no ${id}`)
  const input: ScreenInput = {
    session,
    nodes,
    width: 200,
    height: 40,
    now: NOW,
    frame: 0,
    open: new Set(),
    closed: new Set(),
    thinking: false,
    details: false,
  }
  return screenRows(input).rows.slice(0, 3).map(rowText).join("\n")
}

describe("the tools say what the interface draws", () => {
  test("the same subagents, in the same order, with the same title and calls", async () => {
    for (const { name, ui, agent, root } of await models()) {
      const shown = subagentsOf(ui, root).map((node) => node.session.id)
      const told = subagentsOf(agent, root).map((node) => node.session.id)
      expect(told, name).toEqual(shown)
      const report = subagentReport({ nodes: subagentsOf(agent, root), now: NOW, version: 1 })
      for (const id of shown) {
        const seen = ui.sessions.get(id)
        const kept = agent.sessions.get(id)
        if (!seen || !kept) throw new Error(id)
        expect(callsOf(kept), name).toBe(callsOf(seen))
        const calls = callsOf(seen)
        expect(report, name).toContain(
          `- ${id} · ${seen.agent} · "${titleOf(seen)}" · ${runPhrase(seen, NOW)}`,
        )
        expect(report, name).toContain(`${calls} call${calls === 1 ? "" : "s"}`)
      }
    }
  })

  test("the pane's header states the run in the words the list, the read and the wait use", async () => {
    for (const { name, ui, agent, root } of await models()) {
      for (const { session } of subagentsOf(ui, root)) {
        const phrase = runPhrase(session, NOW)
        expect(pane(ui, root, session.id), name).toContain(phrase)
        const kept = agent.sessions.get(session.id)
        if (!kept) throw new Error(session.id)
        expect(runPhrase(kept, NOW), name).toBe(phrase)
        const read = subagentAccount({ session: kept, children: [], now: NOW, version: 1 })
        expect(read, name).toContain(`State: ${phrase}`)
        const waited = waitReport({ sessions: [kept], now: NOW, version: 1, waited: 0, timedOut: false })
        expect(waited, name).toContain(`· ${phrase}`)
      }
    }
  })

  test("the sidebar's row carries the same title, calls and duration", async () => {
    const ui = applyAll(emptyModel(), states())
    const lines = sidebarLines({ nodes: subagentsOf(ui, "root"), width: 80, now: NOW, frame: 0, limit: 20 })
    const text = lines.map((line) => rowText(line.row)).join("\n")
    const answered = ui.sessions.get("a")
    if (!answered) throw new Error("a")
    expect(text).toContain(titleOf(answered))
    expect(text).toContain(`1 call · ${elapsed(60_000)}`)
    expect(runPhrase(answered, NOW)).toBe(`done in ${elapsed(60_000)}`)
  })
})

describe("a subagent continued the next day (two rounds, a day apart)", () => {
  const ui = applyAll(emptyModel(), continuedSample())
  const agent = applyAll(emptyModel(), slim(continuedSample()))
  const nodes = subagentsOf(ui, CONTINUED_ROOT)
  const seen = ui.sessions.get("ses_c_review")
  const kept = agent.sessions.get("ses_c_review")
  if (!seen || !kept) throw new Error("ses_c_review")

  test("its time is its last round's, and every view says it was round 2", () => {
    /** The whole span is a day; the work was four minutes, twice. */
    expect((seen.ended ?? 0) - seen.started).toBeGreaterThan(24 * 3_600_000)
    expect(roundsOf(seen)).toBe(2)
    expect(runTime(seen, SAMPLE_NOW)).toBe(240_000)
    const phrase = runPhrase(seen, SAMPLE_NOW)
    expect(phrase).toBe("done in 4m00s (round 2)")
    expect(runPhrase(kept, SAMPLE_NOW)).toBe(phrase)

    const first = firstStarted(seen, SAMPLE_NOW) ?? ""
    expect(first).toBe(`first started ${dayClock(seen.started, SAMPLE_NOW)}`)
    expect(firstStarted(kept, SAMPLE_NOW)).toBe(first)

    const header = screenRows({
      session: seen,
      nodes,
      width: 120,
      height: 30,
      now: SAMPLE_NOW,
      frame: 0,
      open: new Set(),
      closed: new Set(),
      thinking: false,
      details: false,
    })
      .rows.slice(0, 2)
      .map(rowText)
      .join("\n")
    expect(header).toContain(phrase)
    expect(header).toContain(first)

    const list = subagentReport({ nodes: subagentsOf(agent, CONTINUED_ROOT), now: SAMPLE_NOW, version: 2 })
    expect(list).toContain(`· ${phrase}, `)
    expect(list).toContain(`; ${first}`)
    expect(list).toContain("· 2 rounds")
    const read = subagentAccount({ session: kept, children: [], now: SAMPLE_NOW, version: 2 })
    expect(read).toContain(`State: ${phrase}, `)
    expect(read).toContain(first)
    const waited = waitReport({ sessions: [kept], now: SAMPLE_NOW, version: 2, waited: 0, timedOut: false })
    expect(waited).toContain(`· ${phrase}, `)

    for (const text of [header, list, read, waited]) expect(text).not.toContain("24h")
  })

  test("the sidebar says the same time, and how many rounds while there is room", () => {
    const row = (width: number) =>
      sidebarLines({ nodes, width, now: SAMPLE_NOW, frame: 0 })
        .map((line) => rowText(line.row))
        .find((text) => text.includes("Review"))
        ?.trimEnd()
    expect(row(60)).toEndWith("17 calls · 4m00s · 2 rounds")
    /** Narrower, the calls give way to the rounds, then the rounds to the title. */
    expect(row(40)).toEndWith("● Review the export qu… 4m00s · 2 rounds")
    expect(row(30)).toEndWith("17 calls · 4m00s")
    for (const width of [30, 40, 60]) expect(row(width)).not.toContain("24h")
  })

  test("one round says nothing of rounds", () => {
    const docs = ui.sessions.get("ses_c_docs")
    if (!docs) throw new Error("ses_c_docs")
    expect(runPhrase(docs, SAMPLE_NOW)).toBe("done in 51s")
    expect(firstStarted(docs, SAMPLE_NOW)).toBeUndefined()
  })

  test("a day's clock: today's time, yesterday, else the date", () => {
    const now = new Date(2026, 9, 2, 9, 5).getTime()
    expect(dayClock(new Date(2026, 9, 2, 0, 1).getTime(), now)).toBe("00:01")
    expect(dayClock(new Date(2026, 9, 1, 22, 17).getTime(), now)).toBe("yesterday 22:17")
    expect(dayClock(new Date(2026, 8, 30, 22, 17).getTime(), now)).toBe("2026-09-30 22:17")
    /** Across a month's end. */
    expect(dayClock(new Date(2026, 8, 30, 8, 0).getTime(), new Date(2026, 9, 1, 1, 0).getTime())).toBe(
      "yesterday 08:00",
    )
  })
})
