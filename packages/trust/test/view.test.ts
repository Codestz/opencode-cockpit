import { describe, expect, test } from "bun:test"
import { createEngine } from "../src/core/engine.ts"
import { DAY, type Event } from "../src/core/ledger.ts"
import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../src/core/sample.ts"
import {
  configSnippet,
  type Line,
  ledgerItems,
  ledgerModel,
  ledgerRows,
  ledgerShown,
  revokeLine,
  sectionOfLine,
  widenLine,
} from "../src/core/view/ledger.ts"
import { type Row, rowText, widthOf } from "../src/core/view/rows.ts"
import { sidebarRows, tally } from "../src/core/view/sidebar.ts"

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

/** The dialog as it draws `name`: every family open unless told otherwise, the cursor on `pick`. */
const ledgerOf = (
  name: string,
  width: number,
  height: number,
  options: { open?: boolean; all?: boolean; pick?: (lines: readonly Line[]) => Line | undefined } = {},
) => {
  const engine = engineOf(name)
  const reading = { state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW }
  const closed = ledgerModel({ ...reading, all: options.all ?? false, open: new Set() })
  const open = new Set(
    options.open === false ? [] : closed.lines.flatMap((line) => (line.kind === "family" ? [line.fold] : [])),
  )
  const { lines, folded } = ledgerModel({ ...reading, all: options.all ?? false, open })
  const selected = (options.pick ?? ((list) => list[0]))(lines)?.key
  return {
    engine,
    lines,
    folded,
    ...ledgerRows({
      width,
      height,
      lines,
      folded,
      ...(options.all ? { all: true } : {}),
      ...(selected !== undefined ? { selected } : {}),
      ...reading,
    }),
  }
}

const textOf = (rows: readonly Row[]) => rows.map(rowText).join("\n")
/** The panel and the keys: the last four rows. */
const panelOf = (rows: readonly Row[]) => textOf(rows.slice(-4))
type Section = "answers" | "learning"
/** The row for `subject`, in the answers or in what is still counting; the first found otherwise. */
const lineFor = (lines: readonly Line[], subject: string, section?: Section) =>
  lines.find(
    (line) =>
      line.kind === "rule" &&
      line.rule.subject === subject &&
      (section === undefined || line.rule.section === section),
  )
const headingFor = (lines: readonly Line[], family: string, section?: Section) =>
  lines.find(
    (line) =>
      line.kind === "family" &&
      line.family.family === family &&
      (section === undefined || line.family.section === section),
  )

describe("the grid: every row exactly its width", () => {
  for (const name of Object.keys(SAMPLES)) {
    test(`sidebar · ${name}`, () => {
      for (const width of [8, 12, 20, 24, 36, 50])
        for (const shown of [false, true])
          for (const row of sidebarOf(name, width, shown)) expect(widthOf(rowText(row))).toBe(width)
    })
    test(`ledger · ${name}`, () => {
      for (const width of [40, 60, 80, 100, 116, 140])
        for (const height of [8, 12, 30])
          for (const open of [false, true]) {
            const { rows, lines } = ledgerOf(name, width, height, { open })
            expect(rows.length).toBe(Math.max(height, 11))
            for (const row of rows) expect(widthOf(rowText(row))).toBe(width)
            /** The cursor on every kind of line: the panel and the keys change with it. */
            for (const line of lines) {
              const each = ledgerOf(name, width, height, { open, pick: () => line })
              for (const row of each.rows) expect(widthOf(rowText(row))).toBe(width)
            }
          }
    })
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

describe("the ledger", () => {
  test("what answers, then what is counting, then OpenCode's own always — each under its heading", () => {
    const { rows, lines } = ledgerOf("busy", 100, 30)
    const sections = lines.map(sectionOfLine)
    /** A section is one run of lines, in this order. */
    expect(sections.filter((each, at) => each !== sections[at - 1])).toEqual([
      "answers",
      "learning",
      "always",
    ])
    const text = textOf(rows)
    expect(text).toMatch(/Answers for you {2}\d+ commands.*answered {2}last/)
    expect(text).toMatch(/Learning {2}\d+ commands?.*approved {2}last/)
    expect(text).toContain(`OpenCode's own "always"`)
    expect(text).toMatch(/○ git push origin feat\/trust {2}dangerous\s+build\s+5 of 8/)
  })

  test("the header says whether Trust is answering; only paused is worth a colour", () => {
    const on = ledgerOf("crowded", 100, 30).rows[0] ?? []
    expect(rowText(on).trimEnd()).toMatch(/Trust in this project\s+on$/)
    const paused = ledgerOf("crowded-paused", 100, 30).rows[0] ?? []
    expect(rowText(paused)).toContain("paused — counting, answering nothing")
    expect(paused.find((run) => run.text.startsWith("paused"))?.tone).toBe("warning")
  })

  test("colour marks a row, it does not label it: agents, counts and times are muted", () => {
    const { rows, lines } = ledgerOf("crowded", 100, 60)
    expect(lines.length).toBeGreaterThan(20)
    for (const row of rows.slice(2, -5).filter((each) => !rowText(each).includes("approved once")))
      for (const run of row.slice(-4)) if (run.text.trim() !== "") expect(run.tone).toBe("muted")
  })

  test("among what is counting, the closest to trusted comes first", () => {
    const { lines } = ledgerOf("crowded", 100, 40, { open: false })
    const left = lines.flatMap((line) =>
      line.kind === "rule" && line.rule.section === "learning"
        ? [(line.rule.entries[0]?.danger ? 8 : 3) - (line.rule.entries[0]?.streak ?? 0)]
        : [],
    )
    expect(left.length).toBeGreaterThan(3)
    expect(left).toEqual([...left].sort((a, b) => a - b))
  })

  test("one agent everywhere: the agent column is left out", () => {
    expect(textOf(ledgerOf("first", 100, 20).rows)).not.toContain("agent")
    expect(textOf(ledgerOf("crowded", 100, 20).rows)).toContain("agent")
  })

  test("the cursor's row is filled, marked in its margin, and stays in view", () => {
    const { rows, lines } = ledgerOf("busy", 80, 12, { pick: (list) => list.at(-1) })
    expect(lines.length).toBeGreaterThan(5)
    const selected = rows.filter((row) => row.every((run) => run.fill === "selected"))
    expect(selected).toHaveLength(1)
    expect(selected[0]?.[0]).toMatchObject({ text: "▌", tone: "accent" })
  })

  test("nothing learned: it says how Trust learns", () => {
    const text = textOf(ledgerOf("empty", 100, 20).rows)
    expect(text).toContain("Nothing learned yet. Approve the same command 3 times in a row")
    expect(text).toContain("A dangerous one takes 8.")
  })

  test("a rule as config, to paste", () => {
    const { lines } = ledgerOf("busy", 100, 30)
    const built = lines.find((line) => line.kind === "rule" && line.rule.subject.startsWith("(in"))
    if (!built) throw new Error("no placed rule")
    expect(configSnippet(built)).toEqual({
      text: '{"permission":{"bash":{"bun run build":"allow"}}}',
      note: "a config rule cannot say where a command runs: this one allows it anywhere",
    })
    const fetch = lines.find((line) => line.kind === "rule" && line.rule.permission === "webfetch")
    if (!fetch) throw new Error("no webfetch rule")
    expect(configSnippet(fetch).text).toBe(
      '{"permission":{"webfetch":{"https://docs.example.com/*":"allow"}}}',
    )
  })

  test("commands approved once are one quiet row under what is counting, and [a] lists them", () => {
    const engine = engineOf("crowded")
    const every = ledgerItems(engine.state, SAMPLE_SETTINGS, SAMPLE_NOW)
    const folded = ledgerShown(every, SAMPLE_SETTINGS, SAMPLE_NOW, false)
    const all = ledgerShown(every, SAMPLE_SETTINGS, SAMPLE_NOW, true)
    expect(all).toEqual({ items: every, folded: 0 })
    expect(folded.items.length + folded.folded).toBe(every.length)
    expect(folded.folded).toBeGreaterThan(100)
    const shut = textOf(ledgerOf("crowded", 100, 60, { open: false }).rows)
    expect(shut).toContain(`+ ${folded.folded} more approved once · [a] lists them`)
    expect(shut.indexOf("more approved once")).toBeGreaterThan(shut.indexOf("Learning"))
    expect(shut.indexOf("more approved once")).toBeLessThan(shut.indexOf("OpenCode's own"))
    expect(shut).toContain("[a] Show All")
    const open = textOf(ledgerOf("crowded", 100, 60, { all: true, open: false }).rows)
    expect(open).toContain("[a] Show Fewer")
    expect(open).not.toContain("approved once ·")
  })

  test("a list taller than the dialog says how many lines are above and below", () => {
    const { rows, lines } = ledgerOf("families", 80, 11, { pick: (list) => list[5] })
    expect(lines.length).toBeGreaterThan(5)
    expect(rows.map(rowText).some((line) => /↑ \d+ more above|↓ \d+ more below/.test(line))).toBe(true)
    for (const row of rows) expect(widthOf(rowText(row))).toBe(80)
  })

  test("[p] Pause outlasts copying when the keys do not all fit", () => {
    const { rows } = ledgerOf("crowded", 80, 16, {
      pick: (lines) => lineFor(lines, "git push origin feat/trust"),
    })
    const footer = rowText(rows.at(-1) ?? []).trimEnd()
    expect(footer).toContain("[p] Pause")
    expect(footer).not.toContain("[c] Copy As Config")
    expect(footer.endsWith("[esc] Close")).toBe(true)
  })
})

describe("families in the ledger", () => {
  test("variants of one program are one family, folded until opened", () => {
    const shut = ledgerOf("families", 100, 30, { open: false })
    expect(headingFor(shut.lines, "ls", "answers")).toBeDefined()
    expect(lineFor(shut.lines, "ls -la")).toBeUndefined()
    expect(textOf(shut.rows)).toMatch(/▸ ls {2}any ls … · 4 commands\s+general\s+4×/)
    const open = ledgerOf("families", 100, 30)
    const rows = open.lines.filter((line) => line.kind === "rule" && line.family.family === "ls")
    expect(rows.map((line) => (line.kind === "rule" ? line.rule.subject : "")).sort()).toEqual([
      "ls -R docs",
      "ls -la",
      "ls -la src",
      "ls -x",
    ])
    expect(textOf(open.rows)).toContain("▾ ls  any ls …")
  })

  test("a family folds in the section it is drawn in", () => {
    const engine = engineOf("crowded")
    const reading = { state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW, all: false }
    const echo = headingFor(ledgerModel({ ...reading, open: new Set() }).lines, "echo", "answers")
    if (echo?.kind !== "family") throw new Error("no echo heading")
    const { lines } = ledgerModel({ ...reading, open: new Set([echo.fold]) })
    const nested = lines.filter((line) => line.kind === "rule" && line.nested)
    expect(nested.map((line) => (line.kind === "rule" ? line.fold : ""))).toEqual([echo.fold, echo.fold])
    expect(lineFor(lines, "echo boom", "learning")?.kind).toBe("rule")
  })

  test("a family of one rule is drawn as that one row, a word a font merges said in words", () => {
    const { lines, rows } = ledgerOf("families", 100, 30)
    expect(headingFor(lines, "echo")).toBeUndefined()
    const echo = lineFor(lines, "echo ---")
    expect(echo?.kind === "rule" && echo.nested).toBe(false)
    expect(textOf(rows)).toMatch(/\n.● echo "---" {2}\(3 hyphens\)\s+general/)
  })

  test("a command trusted for one agent and counting for another is a row in each section", () => {
    const { lines, rows } = ledgerOf("families", 100, 30)
    const answers = lineFor(lines, "git status --short", "answers")
    const learning = lineFor(lines, "git status --short", "learning")
    expect(answers?.kind === "rule" && answers.rule.entries.map((entry) => entry.agent)).toEqual(["build"])
    expect(learning?.kind === "rule" && learning.rule.entries.map((entry) => entry.agent)).toEqual([
      "general",
    ])
    expect(textOf(rows)).toMatch(/○ git status --short\s+general\s+2 of 3/)
    /** Counting stays per agent: two entries in the state, not one. */
    expect(
      [...engineOf("families").state.entries.values()].filter(
        (entry) => entry.subject === "git status --short",
      ),
    ).toHaveLength(2)
    expect(panelOf(ledgerOf("families", 100, 30, { pick: () => answers }).rows)).toContain(
      "Still learning for general: 2 of 3.",
    )
  })

  test("global flags do not split a family: git -C x status is git status", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const status = headingFor(lines, "git status", "answers")
    expect(status?.kind === "family" && status.family.rules.map((rule) => rule.subject).sort()).toEqual([
      "git -C packages/web status",
      "git status --short",
    ])
  })

  test("the panel says exactly what a row is, one labelled fact a row", () => {
    const { rows } = ledgerOf("families", 100, 30, { pick: (lines) => lineFor(lines, "echo ---") })
    const text = panelOf(rows)
    expect(text).toContain('Exactly     echo "---"  — "---" is 3 hyphens, which some fonts draw as one line')
    expect(text).toContain("Answers     this exact text, for general. Forgotten after 30 days unused.")
    expect(text).toContain('Still asks  echo · echo "---" > out.txt · any other argument')
    expect(text).toContain("[w] Trust Any echo")
  })

  test("the panel on a rule still counting says how far it has to go, and [x] forgets", () => {
    const { rows } = ledgerOf("families", 100, 30, { pick: (lines) => lineFor(lines, "src/view.ts") })
    const text = panelOf(rows)
    expect(text).toContain("Approved    2 of 3 in a row, as build — 1 more approval and Trust answers it.")
    expect(text).toContain("[x] Forget")
  })

  test("the panel on a heading says what the family holds and what [w] would do", () => {
    const { rows } = ledgerOf("families", 100, 30, {
      pick: (lines) => headingFor(lines, "git status", "answers"),
    })
    const text = panelOf(rows)
    expect(text).toMatch(/Family {6}git status · 2 commands answered: /)
    expect(text).toContain("Widen       [w] answers any git status … for build")
    expect(text).toContain("[enter] Fold")
  })

  test("a widened family says so, what still asks, and how to stop it", () => {
    const { rows } = ledgerOf("families", 100, 30, { pick: (lines) => headingFor(lines, "ls") })
    const text = panelOf(rows)
    expect(text).toContain("Widened     any ls … for general — you widened it 15m ago.")
    expect(text).toContain("Still asks  dangerous ones, and any that write a file or run another program.")
    expect(text).toContain("To stop     [w] back to exact rules   [x] revokes it and its 4 rules")
    expect(text).toContain("[w] Undo Any ls")
  })

  test("a dangerous rule offers [w] dimmed and says it never widens", () => {
    const { rows } = ledgerOf("families", 100, 30, {
      pick: (lines) => lineFor(lines, "git push origin feat/trust"),
    })
    expect(panelOf(rows)).toContain(
      "Dangerous   git push — 8 in a row instead of 3, and never widened as a family.",
    )
    expect((rows.at(-1) ?? []).find((run) => run.text === "[w]")?.faint).toBe(true)
  })

  test("OpenCode's own always: what it means, and that only a restart ends it", () => {
    const { rows } = ledgerOf("crowded", 100, 40, { pick: (lines) => lines.at(-1) })
    const text = panelOf(rows)
    expect(text).toContain("Means       OpenCode answers every command that starts this way for general")
    expect(text).toContain("Until       OpenCode restarts.")
    expect((rows.at(-1) ?? []).find((run) => run.text === "[x]")?.faint).toBe(true)
  })

  test("the keys keep a command lowercase, and the way out last", () => {
    for (const width of [40, 60, 80, 140]) {
      const { rows } = ledgerOf("families", width, 30, {
        pick: (lines) => headingFor(lines, "git status", "answers"),
      })
      const footer = rowText(rows.at(-1) ?? []).trimEnd()
      expect(footer.endsWith("[esc] Close") || footer.endsWith("[esc]")).toBe(true)
      expect(footer).not.toContain("Git Status")
    }
  })
})

describe("acting on a line", () => {
  const reading = (name: string) => {
    const engine = engineOf(name)
    return { state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW }
  }

  test("[w] on a safe family writes one widened event for the row's agent", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const outcome = widenLine(lineFor(lines, "echo ---") as Line, 5)
    expect(outcome.events).toEqual([
      { v: 1, at: 5, type: "widened", permission: "bash", agent: "general", family: "echo" },
    ])
    expect(outcome.notice.text).toContain("Trusted any echo … for general")
  })

  test("[w] on a dangerous family writes nothing and says why", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const outcome = widenLine(lineFor(lines, "git push origin feat/trust") as Line, 5)
    expect(outcome.events).toEqual([])
    expect(outcome.notice).toEqual({
      text: "Not widened: git push is dangerous — each one earns trust on its own.",
      tone: "warning",
    })
  })

  test("[w] on a widened family un-widens it", () => {
    const { lines } = ledgerOf("families", 100, 30)
    expect(widenLine(headingFor(lines, "ls") as Line, 9).events).toEqual([
      { v: 1, at: 9, type: "unwidened", permission: "bash", agent: "general", family: "ls" },
    ])
    expect(widenLine(lineFor(lines, "ls -la") as Line, 9).events.map((event) => event.type)).toEqual([
      "unwidened",
    ])
  })

  test("[x] on a heading revokes every rule in it, and its widening, and says how many", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const outcome = revokeLine(headingFor(lines, "ls") as Line, reading("families"), 7)
    expect(outcome.events.filter((event) => event.type === "revoked")).toHaveLength(4)
    expect(outcome.events.filter((event) => event.type === "unwidened")).toHaveLength(1)
    expect(outcome.notice.text).toBe(
      "Revoked 4 rules in ls, and its widening — each is asked again until approved 3× in a row.",
    )
  })

  test("[x] acts on its own section: revoking what answers does not forget what is counting", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const now = reading("families")
    const agentsOf = (line: Line | undefined) =>
      revokeLine(line as Line, now, 7).events.map((event) => (event.type === "revoked" ? event.agent : ""))
    expect(agentsOf(lineFor(lines, "git status --short", "answers"))).toEqual(["build"])
    expect(agentsOf(lineFor(lines, "git status --short", "learning"))).toEqual(["general"])
    expect(revokeLine(lineFor(lines, "git status --short", "learning") as Line, now, 7).notice.text).toBe(
      "Forgot the count for git status --short: it starts again from 0.",
    )
  })

  test("[x] on a heading still counting forgets its counts and widens nothing back", () => {
    const { lines } = ledgerOf("crowded", 100, 30, { open: false })
    const outcome = revokeLine(headingFor(lines, "head", "learning") as Line, reading("crowded"), 7)
    expect(outcome.events.every((event) => event.type === "revoked")).toBe(true)
    expect(outcome.events).toHaveLength(4)
    expect(outcome.notice.text).toBe("Forgot 4 counts in head: each starts again from 0.")
  })

  test("[c] on a widened family is a wildcard, and says config cannot name the agent", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const snippet = configSnippet(headingFor(lines, "ls") as Line)
    expect(snippet.text).toBe('{"permission":{"bash":{"ls *":"allow"}}}')
    expect(snippet.note).toContain("config cannot say which agent")
    /** An edit family, as a heading would hold it: its folder, and a `*` that reaches below it. */
    const ls = headingFor(lines, "ls") as Extract<Line, { kind: "family" }>
    const src: Line = { ...ls, family: { ...ls.family, permission: "edit", family: "src/", widened: [] } }
    expect(configSnippet(src).text).toBe('{"permission":{"edit":{"src/*":"allow"}}}')
  })
})
