import { describe, expect, test } from "bun:test"
import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../src/core/sample.ts"
import { configSnippet, ledgerItems, ledgerRows } from "../src/core/view/ledger.ts"
import { rowText, widthOf } from "../src/core/view/rows.ts"
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

const ledgerOf = (name: string, width: number, height: number, selected = 0) => {
  const { engine } = (SAMPLES[name] as () => ReturnType<(typeof SAMPLES)["empty"]>)()
  const items = ledgerItems(engine.state, SAMPLE_SETTINGS, SAMPLE_NOW)
  return {
    items,
    ...ledgerRows({
      width,
      height,
      items,
      selected,
      state: engine.state,
      settings: SAMPLE_SETTINGS,
      now: SAMPLE_NOW,
    }),
  }
}

describe("the grid: every row exactly its width", () => {
  for (const name of Object.keys(SAMPLES)) {
    test(`sidebar · ${name}`, () => {
      for (const width of [8, 12, 20, 24, 36, 50])
        for (const row of sidebarOf(name, width)) expect(widthOf(rowText(row))).toBe(width)
    })
    test(`ledger · ${name}`, () => {
      for (const width of [40, 60, 100, 116])
        for (const height of [8, 12, 30]) {
          const { rows } = ledgerOf(name, width, height)
          expect(rows.length).toBe(Math.max(height, 8))
          for (const row of rows) expect(widthOf(rowText(row))).toBe(width)
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
    const { rows, items } = ledgerOf("busy", 100, 30)
    expect(items[0]?.kind).toBe("rule")
    expect(items.at(-1)?.kind).toBe("always")
    const text = rows.map(rowText).join("\n")
    expect(text).toContain('OpenCode\'s own "always"')
    expect(text).toContain("git push origin feat/trust  git push")
    expect(text).toContain("5/8")
  })

  test("the cursor's row is filled, and stays in view", () => {
    const { rows, items } = ledgerOf("busy", 80, 8, 8)
    expect(items.length).toBeGreaterThan(5)
    const selected = rows.filter((row) => row.every((run) => run.fill === "selected"))
    expect(selected).toHaveLength(1)
  })

  test("a rule as config, to paste", () => {
    const { items } = ledgerOf("busy", 100, 30)
    const built = items.find((item) => item.kind === "rule" && item.entry.subject.startsWith("(in"))
    if (!built) throw new Error("no placed rule")
    expect(configSnippet(built)).toEqual({
      text: '{"permission":{"bash":{"bun run build":"allow"}}}',
      note: "a config rule cannot say where a command runs: this one allows it anywhere",
    })
    const fetch = items.find((item) => item.kind === "rule" && item.entry.permission === "webfetch")
    if (!fetch) throw new Error("no webfetch rule")
    expect(configSnippet(fetch).text).toBe(
      '{"permission":{"webfetch":{"https://docs.example.com/*":"allow"}}}',
    )
  })
})
