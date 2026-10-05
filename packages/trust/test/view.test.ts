import { describe, expect, test } from "bun:test"
import { createEngine } from "../src/core/engine.ts"
import { DAY, type Event } from "../src/core/ledger.ts"
import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../src/core/sample.ts"
import { configSnippet, revoke, widen, widenScope } from "../src/core/view/actions.ts"
import { activityModel, activityRows, answerWhy, targetOf } from "../src/core/view/activity.ts"
import { historyRuns } from "../src/core/view/card.ts"
import { explorerRows } from "../src/core/view/explorer.ts"
import { countsOf } from "../src/core/view/model.ts"
import { type Row, rowText, widthOf } from "../src/core/view/rows.ts"
import { sidebarRows, tally } from "../src/core/view/sidebar.ts"
import { ALWAYS_KEY, explorerModel, type Node, nodeTarget, reveal, TAIL } from "../src/core/view/tree.ts"

const sidebarOf = (name: string, width: number, shown = false) => {
  const { engine, trouble } = (SAMPLES[name] as () => ReturnType<(typeof SAMPLES)["empty"]>)()
  return sidebarRows({
    width,
    recent: engine.recent(),
    count: engine.count(),
    pending: engine.pending(),
    state: engine.state,
    limit: 3,
    shown,
    ...(shown ? { project: tally(engine.state, SAMPLE_SETTINGS, SAMPLE_NOW) } : {}),
    ...(trouble ? { trouble } : {}),
  })
}

type Make = () => ReturnType<(typeof SAMPLES)["empty"]>
const engineOf = (name: string) => (SAMPLES[name] as Make)().engine
const readingOf = (name: string) => {
  const engine = engineOf(name)
  return { engine, state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW, history: engine.history }
}
const textOf = (rows: readonly Row[]) => rows.map(rowText).join("\n")
const footerOf = (rows: readonly Row[]) => rowText(rows.at(-1) ?? []).trimEnd()

const activity = (
  name: string,
  width = 100,
  height = 24,
  extra: { selected?: string; keys?: boolean } = {},
) => {
  const reading = readingOf(name)
  return { ...reading, ...activityRows({ ...reading, width, height, project: "app", ...extra }) }
}

/** The ledger with `open` families, the cursor on what `pick` finds. */
const ledger = (
  name: string,
  options: {
    width?: number
    height?: number
    open?: "all" | "none"
    filter?: string
    pick?: (nodes: readonly Node[]) => Node | undefined
    focus?: { button: number }
    typing?: string
    keys?: boolean
  } = {},
) => {
  const reading = readingOf(name)
  const open = new Set<string>()
  const full = new Set<string>()
  if (options.open === "all")
    for (const family of explorerModel({ ...reading, open, full, filter: "" }).families) {
      open.add(family.key)
      full.add(family.key)
    }
  const filter = options.filter ?? ""
  const model = explorerModel({ ...reading, open, full, filter })
  const selected = (options.pick ?? ((nodes) => nodes[0]))(model.nodes)?.key
  return {
    ...reading,
    open,
    full,
    ...explorerRows({
      ...reading,
      open,
      full,
      filter,
      width: options.width ?? 100,
      height: options.height ?? 24,
      project: "app",
      ...(selected !== undefined ? { selected } : {}),
      ...(options.focus ? { focus: options.focus } : {}),
      ...(options.typing !== undefined ? { typing: options.typing } : {}),
      ...(options.keys ? { keys: true } : {}),
    }),
  }
}
const commandNode = (subject: string) => (nodes: readonly Node[]) =>
  nodes.find((node) => node.kind === "command" && node.command.subject === subject)

describe("the grid: every row exactly its width", () => {
  for (const name of Object.keys(SAMPLES)) {
    test(`sidebar · ${name}`, () => {
      for (const width of [8, 12, 20, 24, 36, 50])
        for (const shown of [false, true])
          for (const row of sidebarOf(name, width, shown)) expect(widthOf(rowText(row))).toBe(width)
    })
    test(`activity · ${name}`, () => {
      for (const width of [40, 60, 80, 116, 140])
        for (const height of [8, 11, 20, 40])
          for (const keys of [false, true]) {
            const first = activity(name, width, height, { keys })
            const each = [undefined, ...first.model.items.map((item) => item.key)]
            for (const selected of each) {
              const { rows } = activity(name, width, height, { keys, ...(selected ? { selected } : {}) })
              expect(rows.length).toBe(Math.max(height, 11))
              for (const row of rows) expect(widthOf(rowText(row))).toBe(width)
            }
          }
    }, 60_000)
    test(`ledger · ${name}`, () => {
      for (const width of [40, 60, 89, 90, 116, 140])
        for (const height of [8, 20, 40])
          for (const open of ["none", "all"] as const) {
            const nodes = ledger(name, { width, height, open }).model.nodes.slice(0, 16)
            for (const node of [undefined, ...nodes])
              for (const extra of [{}, { focus: { button: 1 } }, { typing: "he" }]) {
                const view = ledger(name, {
                  width,
                  height,
                  open,
                  ...(node ? { pick: () => node } : {}),
                  ...extra,
                })
                expect(view.rows.length).toBe(Math.max(height, 11))
                for (const row of view.rows) expect(widthOf(rowText(row))).toBe(width)
              }
            const keys = ledger(name, { width, height, open, keys: true })
            for (const row of keys.rows) expect(widthOf(rowText(row))).toBe(width)
          }
    }, 120_000)
  }
})

describe("the sidebar", () => {
  test("silent with nothing to say", () => {
    expect(sidebarOf("empty", 36)).toEqual([])
  })

  /** Shown from the palette with nothing yet, an empty block read as a command that did nothing. */
  test("asked for, a project with nothing learned says so", () => {
    const rows = sidebarOf("empty", 36, true).map((row) => rowText(row).trimEnd())
    expect(rows[0]).toBe(`Trust${" ".repeat(12)}nothing learned yet`)
  })

  /**
   * A window just opened has answered nothing, while the ledger holds the project's history: shown,
   * the heading tallies the history instead of staying silent.
   */
  test("asked for, a new window shows the project's standing", () => {
    const about = (i: number, subject: string, agent = "build") => ({
      request: `per_${subject}_${agent}_${i}`,
      session: "ses_old",
      call: `call_${subject}_${agent}_${i}`,
      permission: "bash",
      agent,
      items: [{ subject }],
    })
    const at = SAMPLE_NOW - 3 * DAY
    const events: Event[] = [
      ...[1, 2, 3].map((i) => ({
        v: 1 as const,
        at: at + i,
        type: "approved" as const,
        ...about(i, "git status"),
      })),
      /** The same command earned by a second agent is still one command. */
      ...[1, 2, 3].map((i) => ({
        v: 1 as const,
        at: at + 10 + i,
        type: "approved" as const,
        ...about(i, "git status", "general"),
      })),
      { v: 1, at: at + 20, type: "approved", ...about(1, "ls -la") },
    ]
    const engine = createEngine(SAMPLE_SETTINGS)
    engine.load(events)
    const input = {
      width: 36,
      recent: engine.recent(),
      count: engine.count(),
      pending: engine.pending(),
      state: engine.state,
      limit: 3,
    }
    expect(engine.count()).toBe(0)
    expect(sidebarRows(input)).toEqual([])
    const project = tally(engine.state, SAMPLE_SETTINGS, SAMPLE_NOW)
    expect(project).toEqual({ trusted: 1, counting: 1 })
    const rows = sidebarRows({ ...input, shown: true, project }).map((row) => rowText(row).trimEnd())
    expect(rows[0]).toBe(`Trust${" ".repeat(9)}1 trusted · 1 counting`)
    /** Too narrow for all of it, the heading keeps what it can. */
    expect(rowText(sidebarRows({ ...input, width: 20, shown: true, project })[0] ?? []).trimEnd()).toBe(
      `Trust${" ".repeat(6)}1 trusted`,
    )
  })

  test("asked for, this window's answers lead the project's standing", () => {
    const rows = sidebarOf("busy", 50, true).map((row) => rowText(row).trimEnd())
    expect(rows[0]).toMatch(/^Trust +\d+ auto · \d+ trusted( · \d+ counting)?$/)
  })

  test("a failure always speaks", () => {
    expect(sidebarOf("trouble", 36).map(rowText).join("\n")).toContain("⚠ ledger not saved")
  })

  test("answers, how often, and what is being counted", () => {
    expect(sidebarOf("first", 36).map((row) => rowText(row).trimEnd())).toEqual([
      "Trust                         1 auto",
      "",
      "● git status                      1×",
      "○ docker compose -p cockpit up … 2/3",
    ])
  })

  test("paused says so", () => {
    expect(rowText(sidebarOf("paused", 36)[0] ?? [])).toContain("paused")
  })
})

describe("the week, as the activity reads it", () => {
  test("answers per day, today last, and the feed newest first", () => {
    const { model } = activity("busy")
    expect(model.week).toHaveLength(7)
    expect(model.week.reduce((sum, each) => sum + each, 0)).toBeGreaterThan(model.today)
    const times = model.feed.map((item) => (item.kind === "answer" ? item.answer.at : 0))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  test("a rule's moments read back as how it earned its trust", () => {
    const { history } = readingOf("busy")
    const marks = history.marks.get(JSON.stringify(["bash", "build", "git status --short"])) ?? []
    const text = historyRuns(marks, 3, 30 * DAY, SAMPLE_NOW)
      .map((run) => run.text)
      .join("")
    expect(text).toMatch(/^✓ \d+d {2}✓ \d+d {2}✓ \d+d {2}→ trusted {2}answered \d+×$/)
  })
})

describe("the activity: what Trust did, then what it is about to do", () => {
  test("today's answers, a sparkline of the week, what is close, OpenCode's own, the rules", () => {
    const text = textOf(activity("busy").rows)
    expect(text).toMatch(/TODAY {2}Trust answered \d+ prompts for you/)
    expect(text).toContain("last 7 days")
    expect(text).toContain("ALMOST THERE")
    expect(text).toContain("! WATCH OUT")
    expect(text).toMatch(/RULES {2}\d+ trusted · \d+ learning · \d+ seen once/)
    expect(text).toContain(" l Open the ledger ")
    expect(footerOf(activity("busy").rows)).toMatch(/^ \[enter\] Why .*\[esc\] Close$/)
  })

  test("why each answer was given, in words", () => {
    const reading = readingOf("busy")
    const said = activityModel(reading).feed.map((item) =>
      item.kind === "answer" ? answerWhy(item.answer, reading) : "",
    )
    expect(said).toContain("both commands trusted")
    expect(said).toContain("in a family you widened: cat")
    expect(said.some((each) => /^trusted .*, 3 in a row$/.test(each))).toBe(true)
  })

  test("what is close comes closest first, dangerous last, with a meter and a badge", () => {
    const { model, rows } = activity("busy")
    const close = model.almost.map((item) => (item.kind === "almost" ? item.command.subject : ""))
    expect(close.at(-1)).toBe("git push origin feat/trust")
    const row = rows.map(rowText).find((each) => each.includes("git push origin feat/trust")) ?? ""
    expect(row).toContain("▰▰▰▰▰▱▱▱")
    expect(row).toContain("5 of 8")
    expect(row).toContain(" dangerous ")
  })

  test("a new project says how Trust learns, and has no lists to show", () => {
    const text = textOf(activity("empty").rows)
    expect(text).toContain("Nothing answered yet")
    expect(text).toContain("Approve the same command 3 times in a row")
    expect(text).toContain("nothing learned yet")
    expect(text).not.toContain("ALMOST THERE")
    expect(text).not.toContain("WATCH OUT")
  })

  test("paused, the header says so and the keys offer the way back", () => {
    const { rows } = activity("paused")
    expect(rowText(rows[0] ?? [])).toContain("○ paused")
    expect(footerOf(rows)).toContain("[p] Resume")
  })

  test("the cursor's row is marked and filled, and stays in view in a short dialog", () => {
    const { model } = activity("crowded", 100, 11)
    const last = model.items.at(-1)?.key
    const { rows } = activity("crowded", 100, 11, last ? { selected: last } : {})
    const marked = rows.filter((row) => row[0]?.text === "▌")
    expect(marked).toHaveLength(1)
    expect(marked[0]?.every((run) => run.fill !== undefined && run.fill !== "none")).toBe(true)
  })

  test("the ledger button is a click target", () => {
    const { hits } = activity("busy")
    expect(hits.some((hit) => hit.kind === "button" && hit.action === "ledger")).toBe(true)
  })
})

describe("the ledger: families as a tree, a card for the selection", () => {
  test("each command appears once, under its family", () => {
    const { model } = ledger("crowded", { open: "all" })
    const keys = model.nodes.flatMap((node) => (node.kind === "command" ? [node.command.key] : []))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBe(model.commands.length)
  })

  test("a family opens to its first commands and folds the rest into + N more", () => {
    const reading = readingOf("crowded")
    const families = explorerModel({ ...reading, open: new Set(), full: new Set(), filter: "" }).families
    const head = families.find((family) => family.family === "head")
    expect(head?.commands.length).toBeGreaterThan(TAIL + 1)
    const open = new Set([head?.key ?? ""])
    const nodes = explorerModel({ ...reading, open, full: new Set(), filter: "" }).nodes
    const more = nodes.find((node) => node.kind === "more")
    expect(more?.kind === "more" && more.hidden).toBe((head?.commands.length ?? 0) - TAIL)
  })

  test("reveal opens a command's family, its tail too, and returns its row", () => {
    const reading = readingOf("crowded")
    const families = explorerModel({ ...reading, open: new Set(), full: new Set(), filter: "" }).families
    const head = families.find((family) => family.family === "head")
    const last = head?.commands.at(-1)
    const tree = { open: new Set<string>(), full: new Set<string>() }
    const key = reveal(tree, families, { permission: "bash", subject: last?.subject ?? "" })
    const nodes = explorerModel({ ...reading, ...tree, filter: "" }).nodes
    expect(nodes.some((node) => node.key === key)).toBe(true)
  })

  test("the card: the command, each agent's standing, the history that earned it, the buttons", () => {
    const view = ledger("busy", { pick: commandNode("git status --short"), open: "all" })
    const text = textOf(view.rows)
    expect(text).toContain("✓ Trusted for  build  · answered")
    expect(text).toMatch(/History +✓ \d+d {2}✓ \d+d {2}✓ \d+d {2}→ trusted/)
    expect(text).toContain("3 approvals in a row, all yours")
    expect(text).toMatch(/Still asks +git status · git status --short > out\.txt/)
    expect(text).toContain(" x Revoke ")
    expect(text).toContain(" w Trust any git status ")
    expect(text).toContain(" c Copy rule ")
  })

  test("a command trusted for one agent and counting for another: one row, both standings", () => {
    const view = ledger("crowded", { pick: commandNode("git status --short"), open: "all" })
    const text = textOf(view.rows)
    expect(text).toContain("✓ Trusted for  build ")
    expect(text).toContain("for  general ")
  })

  test("a dangerous command: a red meter, its badge, and a w that never widens", () => {
    const view = ledger("dangerous", { pick: commandNode("git push origin feat/trust") })
    const text = textOf(view.rows)
    expect(text).toContain("▰▰▰▰▰▱▱▱")
    expect(text).toMatch(/Dangerous +git push — 8 in a row instead of 3/)
    expect(view.buttons.find((each) => each.key === "w")?.off).toBe(true)
  })

  test("a family you widened says so, and w undoes it", () => {
    const view = ledger("families", {
      pick: (nodes) => nodes.find((node) => node.kind === "family" && node.family.widened.length > 0),
    })
    expect(textOf(view.rows)).toMatch(/✓ Any ls … trusted for {2}general /)
    expect(view.buttons.find((each) => each.key === "w")?.label).toBe("Undo any ls")
  })

  test("OpenCode's own always is the last node, and cannot be revoked", () => {
    const view = ledger("busy", { pick: (nodes) => nodes.at(-1) })
    expect(view.node?.key).toBe(ALWAYS_KEY)
    expect(textOf(view.rows)).toContain("until OpenCode restarts")
    expect(view.buttons.find((each) => each.key === "x")?.off).toBe(true)
  })

  test("wide, the card is beside the tree; under 90 columns, under it", () => {
    expect(ledger("busy", { width: 100 }).wide).toBe(true)
    const narrow = ledger("busy", { width: 80, pick: commandNode("git status --short"), open: "all" })
    expect(narrow.wide).toBe(false)
    const text = textOf(narrow.rows)
    expect(text.indexOf("FAMILIES")).toBeLessThan(text.indexOf("Exactly"))
    expect(narrow.rows.some((row) => row[0]?.text === "▌")).toBe(true)
  })

  test("the filter keeps what matches, and the heading shows what is typed", () => {
    const view = ledger("crowded", { filter: "head" })
    expect(
      view.model.nodes.every((node) => node.kind !== "command" || node.command.subject.includes("head")),
    ).toBe(true)
    expect(textOf(ledger("crowded", { typing: "hea" }).rows)).toContain("/ hea▍")
  })

  test("tab into the card focuses a button, and the keys change to say so", () => {
    const view = ledger("busy", {
      pick: commandNode("git status --short"),
      open: "all",
      focus: { button: 0 },
    })
    expect(view.rows.some((row) => row.some((run) => run.fill === "buttonOn"))).toBe(true)
    expect(footerOf(view.rows)).toContain("[enter] Press")
  })

  test("buttons are click targets where they are drawn", () => {
    const view = ledger("busy", { pick: commandNode("git status --short"), open: "all" })
    for (const hit of view.hits)
      if (hit.kind === "button") {
        const row = rowText(view.rows[hit.y] ?? [])
        expect(
          row
            .slice(hit.x0, hit.x1)
            .trim()
            .startsWith(hit.action === "revoke" ? "x" : hit.action === "widen" ? "w" : "c"),
        ).toBe(true)
      }
    expect(view.hits.filter((hit) => hit.kind === "button")).toHaveLength(3)
  })

  test("the footer: move, fold, card, filter, keys, and esc goes back", () => {
    expect(footerOf(ledger("busy", { width: 116 }).rows)).toBe(
      " [↑/↓] Move   [←/→] Fold   [tab] Card   [/] Filter   [p] Pause   [?] Keys   [esc] Back",
    )
  })

  test("the counts: one per command", () => {
    const { model } = ledger("crowded")
    const counts = countsOf(model.commands)
    expect(counts.trusted + counts.learning + counts.once).toBe(model.commands.length)
  })
})

describe("acting on a selection", () => {
  const at = SAMPLE_NOW + 1
  test("x on a trusted command revokes it for every agent", () => {
    const view = ledger("crowded", { pick: commandNode("git status --short"), open: "all" })
    const outcome = revoke(nodeTarget(view.node as Node), view, at)
    expect(outcome.events.map((event) => event.type === "revoked" && event.agent).sort()).toEqual([
      "build",
      "general",
    ])
  })

  test("x on an answer given through a widening stops the widening", () => {
    const reading = readingOf("busy")
    const model = activityModel(reading)
    const item = model.feed.find((each) => each.kind === "answer" && each.answer.items.some((i) => i.via))
    const outcome = revoke(targetOf(item as NonNullable<typeof item>, model), reading, at)
    expect(outcome.events).toEqual([
      { v: 1, at, type: "unwidened", permission: "bash", agent: "general", family: "cat" },
    ])
  })

  test("w on a safe command widens its family for its agent; on a dangerous one, nothing", () => {
    const view = ledger("busy", { pick: commandNode("bun --version") })
    const families = view.model.families
    const ok = widen(widenScope(nodeTarget(view.node as Node), families), families, at)
    expect(ok.events).toEqual([
      { v: 1, at, type: "widened", permission: "bash", agent: "build", family: "bun" },
    ])
    const danger = ledger("busy", { pick: commandNode("git push origin feat/trust") })
    const refused = widen(widenScope(nodeTarget(danger.node as Node), families), families, at)
    expect(refused.events).toEqual([])
    expect(refused.notice.text).toContain("dangerous")
  })

  test("c on a widened family is a wildcard, and says config cannot name the agent", () => {
    const view = ledger("families", {
      pick: (nodes) => nodes.find((node) => node.kind === "family" && node.family.widened.length > 0),
    })
    const snippet = configSnippet(nodeTarget(view.node as Node))
    expect(snippet.text).toBe(JSON.stringify({ permission: { bash: { "ls *": "allow" } } }))
    expect(snippet.note).toContain("config cannot say which agent")
  })
})
