import { describe, expect, test } from "bun:test"
import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../src/core/sample.ts"
import {
  configSnippet,
  type Line,
  ledgerItems,
  ledgerModel,
  ledgerRows,
  ledgerShown,
  revokeLine,
  widenLine,
} from "../src/core/view/ledger.ts"
import { type Row, rowText, widthOf } from "../src/core/view/rows.ts"
import { sidebarRows } from "../src/core/view/sidebar.ts"

const sidebarOf = (name: string, width: number) => {
  const { engine, trouble } = (SAMPLES[name] as () => ReturnType<(typeof SAMPLES)["empty"]>)()
  return sidebarRows({
    width,
    recent: engine.recent(),
    count: engine.count(),
    pending: engine.pending(),
    state: engine.state,
    limit: 3,
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
    options.open === false
      ? []
      : closed.lines.flatMap((line) => (line.kind === "family" ? [line.family.key] : [])),
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
const lineFor = (lines: readonly Line[], subject: string) =>
  lines.find((line) => line.kind === "rule" && line.rule.subject === subject)
const headingFor = (lines: readonly Line[], family: string) =>
  lines.find((line) => line.kind === "family" && line.family.family === family)

describe("the grid: every row exactly its width", () => {
  for (const name of Object.keys(SAMPLES)) {
    test(`sidebar · ${name}`, () => {
      for (const width of [8, 12, 20, 24, 36, 50])
        for (const row of sidebarOf(name, width)) expect(widthOf(rowText(row))).toBe(width)
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
  test("trusted first, OpenCode's own always last under its warning", () => {
    const { rows, lines } = ledgerOf("busy", 100, 30)
    expect(lines[0]?.kind).not.toBe("always")
    expect(lines.at(-1)?.kind).toBe("always")
    const text = textOf(rows)
    expect(text).toContain('OpenCode\'s own "always"')
    expect(text).toContain("git push origin feat/trust  git push")
    expect(text).toContain("5/8")
  })

  test("the cursor's row is filled, and stays in view", () => {
    const { rows, lines } = ledgerOf("busy", 80, 12, { pick: (list) => list.at(-1) })
    expect(lines.length).toBeGreaterThan(5)
    const selected = rows.filter((row) => row.every((run) => run.fill === "selected"))
    expect(selected).toHaveLength(1)
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

  test("a command approved once is folded into one line, and [a] lists it", () => {
    const engine = engineOf("busy")
    const every = ledgerItems(engine.state, SAMPLE_SETTINGS, SAMPLE_NOW)
    const folded = ledgerShown(every, SAMPLE_SETTINGS, SAMPLE_NOW, false)
    const all = ledgerShown(every, SAMPLE_SETTINGS, SAMPLE_NOW, true)
    expect(all).toEqual({ items: every, folded: 0 })
    expect(folded.items.length + folded.folded).toBe(every.length)
    expect(folded.folded).toBeGreaterThan(0)
    const shut = textOf(ledgerOf("busy", 100, 40).rows)
    expect(shut).toContain(`+ ${folded.folded} approved once · [a] show all`)
    expect(shut).toContain("[a] Show All")
    const open = textOf(ledgerOf("busy", 100, 40, { all: true }).rows)
    expect(open).toContain("[a] Fold Seen Once")
    expect(open).not.toContain("approved once ·")
  })

  test("a list taller than the dialog says what is above and below", () => {
    const { rows, lines } = ledgerOf("families", 80, 11, { pick: (list) => list[5] })
    expect(lines.length).toBeGreaterThan(5)
    expect(rows.map(rowText).some((line) => /↑ \d+ more above|↓ \d+ more below/.test(line))).toBe(true)
    for (const row of rows) expect(widthOf(rowText(row))).toBe(80)
  })
})

describe("families in the ledger", () => {
  test("variants of one program are one family, folded until opened", () => {
    const shut = ledgerOf("families", 100, 30, { open: false })
    const ls = headingFor(shut.lines, "ls")
    expect(ls).toBeDefined()
    expect(lineFor(shut.lines, "ls -la")).toBeUndefined()
    expect(textOf(shut.rows)).toMatch(/▸ ls — any, widened\s+4 trusted/)
    const open = ledgerOf("families", 100, 30)
    const rows = open.lines.filter((line) => line.kind === "rule" && line.family.family === "ls")
    expect(rows.map((line) => (line.kind === "rule" ? line.rule.subject : ""))).toEqual([
      "ls -la",
      "ls -la src",
      "ls -x",
      "ls -R docs",
    ])
    expect(textOf(open.rows)).toContain("▾ ls — any, widened")
  })

  test("a family of one rule is drawn as that one row", () => {
    const { lines, rows } = ledgerOf("families", 100, 30)
    expect(headingFor(lines, "echo")).toBeUndefined()
    const echo = lineFor(lines, "echo ---")
    expect(echo?.kind === "rule" && echo.nested).toBe(false)
    expect(textOf(rows)).toMatch(/\n ● echo "---"\s+general/)
  })

  test("the same command earned by two agents is one row naming both", () => {
    const { lines, rows } = ledgerOf("families", 100, 30)
    const status = lines.filter((line) => line.kind === "rule" && line.rule.subject === "git status --short")
    expect(status).toHaveLength(1)
    const row = status[0]
    expect(row?.kind === "rule" && row.rule.entries.map((entry) => entry.agent)).toEqual(["build", "general"])
    expect(textOf(rows)).toMatch(/git status --short\s+build, general\s+trusted, 2\/3 · 2 auto/)
    /** Counting stays per agent: two entries in the state, not one. */
    expect(
      [...engineOf("families").state.entries.values()].filter(
        (entry) => entry.subject === "git status --short",
      ),
    ).toHaveLength(2)
  })

  test("global flags do not split a family: git -C x status is git status", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const status = headingFor(lines, "git status")
    expect(status?.kind === "family" && status.family.rules.map((rule) => rule.subject)).toEqual([
      "git status --short",
      "git -C packages/web status",
    ])
  })

  test("the panel says exactly what a row is, quoted so no font can merge it", () => {
    const { rows } = ledgerOf("families", 100, 30, { pick: (lines) => lineFor(lines, "echo ---") })
    const text = textOf(rows.slice(-4))
    expect(text).toContain('Exactly   echo "---"')
    expect(text).toContain("only this exact text, as general")
    expect(text).toContain('Still asks: echo · echo "---" > out.txt')
    expect(text).toContain("[w] Trust Any echo")
  })

  test("the panel on a heading says what the family holds and what [w] would do", () => {
    const { rows } = ledgerOf("families", 100, 30, { pick: (lines) => headingFor(lines, "git status") })
    const text = textOf(rows.slice(-4))
    expect(text).toContain(
      "Family    git status · 2 commands: git status --short · git -C packages/web status",
    )
    expect(text).toContain("[w] would answer any git status … as build")
    expect(text).toContain("general keeps its own count")
    expect(text).toContain("[enter] Fold")
  })

  test("a widened family says so, and [w] offers to undo it", () => {
    const { rows } = ledgerOf("families", 100, 30, { pick: (lines) => headingFor(lines, "ls") })
    const text = textOf(rows.slice(-4))
    expect(text).toContain("Widened   any ls … as general")
    expect(text).toContain("[w] Undo Any ls")
    expect(textOf(rows)).toMatch(/ls -x\s+general\s+widened · 1 auto/)
  })

  test("a dangerous family offers [w] dimmed and says it never widens", () => {
    const { rows } = ledgerOf("families", 100, 30, {
      pick: (lines) => lineFor(lines, "git push origin feat/trust"),
    })
    expect(textOf(rows.slice(-4)).replace(/\s+/g, " ")).toContain("Never widened: the family is dangerous")
    const footer = rows.at(-1) ?? []
    expect(footer.find((run) => run.text === "[w]")?.faint).toBe(true)
  })

  test("the keys keep a command lowercase, and the way out last", () => {
    for (const width of [40, 60, 80, 140]) {
      const { rows } = ledgerOf("families", width, 30, { pick: (lines) => headingFor(lines, "git status") })
      const footer = rowText(rows.at(-1) ?? []).trimEnd()
      expect(footer.endsWith("[esc] Close") || footer.endsWith("[esc]")).toBe(true)
      expect(footer).not.toContain("Git Status")
    }
  })
})

describe("acting on a line", () => {
  const reading = (name: string) => {
    const engine = engineOf(name)
    return { engine, reading: { state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW } }
  }

  test("[w] on a safe family writes one widened event for the row's agent", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const echo = lineFor(lines, "echo ---") as Line
    const outcome = widenLine(echo, 5)
    expect(outcome.events).toEqual([
      { v: 1, at: 5, type: "widened", permission: "bash", agent: "general", family: "echo" },
    ])
    expect(outcome.notice.text).toContain("Trusted any echo … for general")
  })

  test("[w] on a dangerous family writes nothing and says why", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const push = lineFor(lines, "git push origin feat/trust") as Line
    const outcome = widenLine(push, 5)
    expect(outcome.events).toEqual([])
    expect(outcome.notice).toEqual({
      text: "Not widened: git push is dangerous — each one earns trust on its own.",
      tone: "warning",
    })
  })

  test("[w] on a widened family un-widens it", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const ls = headingFor(lines, "ls") as Line
    expect(widenLine(ls, 9).events).toEqual([
      { v: 1, at: 9, type: "unwidened", permission: "bash", agent: "general", family: "ls" },
    ])
    const row = lineFor(lines, "ls -la") as Line
    expect(widenLine(row, 9).events.map((event) => event.type)).toEqual(["unwidened"])
  })

  test("[x] on a heading revokes every rule in it, and its widening, and says how many", () => {
    const { reading: now } = reading("families")
    const { lines } = ledgerOf("families", 100, 30)
    const outcome = revokeLine(headingFor(lines, "ls") as Line, now, 7)
    expect(outcome.events.filter((event) => event.type === "revoked")).toHaveLength(4)
    expect(outcome.events.filter((event) => event.type === "unwidened")).toHaveLength(1)
    expect(outcome.notice.text).toBe(
      "Revoked 4 rules in ls, and its widening — each is asked again until approved 3× in a row.",
    )
  })

  test("[x] on a row revokes it for every agent on the row", () => {
    const { reading: now } = reading("families")
    const { lines } = ledgerOf("families", 100, 30)
    const outcome = revokeLine(lineFor(lines, "git status --short") as Line, now, 7)
    expect(outcome.events.map((event) => (event.type === "revoked" ? event.agent : ""))).toEqual([
      "build",
      "general",
    ])
  })

  test("[c] on a widened family is a wildcard, and says config cannot name the agent", () => {
    const { lines } = ledgerOf("families", 100, 30)
    const snippet = configSnippet(headingFor(lines, "ls") as Line)
    expect(snippet.text).toBe('{"permission":{"bash":{"ls *":"allow"}}}')
    expect(snippet.note).toContain("config cannot say which agent")
    const edit = configSnippet(headingFor(lines, "src/") as Line)
    expect(edit.text).toBe('{"permission":{"edit":{"src/*":"allow"}}}')
  })
})
