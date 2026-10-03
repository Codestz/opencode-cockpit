import { describe, expect, test } from "bun:test"
import { emptyBlock } from "@opencode-cockpit/client/design"
import { arrange, conversationThings } from "../src/core/model.ts"
import { SAMPLE_NOW, SAMPLES, type Sample } from "../src/core/sample.ts"
import { emptyState } from "../src/core/store.ts"
import { runAdd } from "../src/core/tools.ts"
import { type DialogInput, dialogRows, MIN_HEIGHT, type Tab } from "../src/core/view/dialog.ts"
import { type Row, rowText, widthOf } from "../src/core/view/rows.ts"
import { EMPTY_TEXT, sidebarRows } from "../src/core/view/sidebar.ts"

const sample = (name: string) => (SAMPLES[name] as () => Sample)()
const texts = (rows: readonly Row[]) => rows.map((row) => rowText(row).trimEnd())
const sidebarOf = (name: string, width: number, limit = 6) => {
  const { state, session } = sample(name)
  return sidebarRows({ width, arranged: arrange(conversationThings(state, session)), now: SAMPLE_NOW, limit })
}
const dialogOf = (name: string, extra: Partial<DialogInput> = {}) => {
  const { state, session, found } = sample(name)
  return dialogRows({
    width: 100,
    height: 24,
    tab: "this",
    state,
    session,
    found,
    now: SAMPLE_NOW,
    project: "opencode-cockpit",
    ...extra,
  })
}

describe("the grid: every row exactly its width", () => {
  const names = Object.keys(SAMPLES)
  for (const name of names)
    test(name, () => {
      for (const width of [20, 30, 36, 42, 60])
        for (const row of sidebarOf(name, width).rows) expect(widthOf(rowText(row))).toBe(width)
      for (const tab of ["this", "all"] as Tab[])
        for (const [width, height] of [
          [40, MIN_HEIGHT],
          [60, 12],
          [80, 20],
          [116, 30],
          [200, 44],
        ] as const) {
          const { rows } = dialogOf(name, { tab, width, height })
          expect(rows).toHaveLength(height)
          for (const row of rows) expect(widthOf(rowText(row))).toBe(width)
        }
    })
})

describe("the sidebar block", () => {
  test("empty: the heading, its row of air, and `none yet` in the first record's slot", () => {
    const rows = texts(sidebarOf("empty", 36).rows)
    expect(rows).toEqual(["Trail", "", EMPTY_TEXT])
    const one = texts(sidebarOf("one", 36).rows)
    expect(one).toHaveLength(rows.length)
    expect(one[0]).toMatch(/^Trail +1$/)
  })

  test("empty is the client's block: the same rows every bay draws", () => {
    const ours = sidebarOf("empty", 30).rows
    const theirs = emptyBlock("Trail", 30).map((runs) => runs.map((run) => run.text).join(""))
    expect(ours.map(rowText)).toEqual(theirs)
  })

  test("a settings notice: `!`, wrapped to the column under the heading — even hidden when empty", () => {
    const notice = 'settings: "trail.sidebarRows" should be a number; the default is used'
    const { state, session } = sample("one")
    const one = sidebarRows({
      width: 30,
      arranged: arrange(conversationThings(state, session)),
      now: SAMPLE_NOW,
      limit: 5,
      notices: [notice],
    })
    const rows = texts(one.rows)
    expect(rows[0]).toMatch(/^Trail +1$/)
    expect(rows[2]).toMatch(/^! settings:/)
    expect(rows.slice(2, 5).join(" ")).toContain("the default")
    for (const row of one.rows) expect(widthOf(rowText(row))).toBe(30)
    expect(one.rows[2]?.[0]).toMatchObject({ text: "! ", tone: "warning" })
    /** The click on the record still lands on the record, below the notice. */
    const hit = one.hits[0]
    expect(hit && rows[hit.y]).toContain("PR #33")

    const hidden = texts(
      sidebarRows({
        width: 30,
        arranged: arrange([]),
        now: SAMPLE_NOW,
        limit: 5,
        hideWhenEmpty: true,
        notices: [notice],
      }).rows,
    )
    expect(hidden[0]).toBe("Trail")
    expect(hidden[2]).toMatch(/^! settings:/)
    expect(hidden).not.toContain(EMPTY_TEXT)
  })

  test("hideWhenEmpty draws nothing, and only while empty", () => {
    const empty = sample("empty")
    expect(
      sidebarRows({ width: 36, arranged: arrange([]), now: SAMPLE_NOW, limit: 5, hideWhenEmpty: true }).rows,
    ).toEqual([])
    const one = sample("one")
    expect(
      sidebarRows({
        width: 36,
        arranged: arrange(conversationThings(one.state, one.session)),
        now: SAMPLE_NOW,
        limit: 5,
        hideWhenEmpty: true,
      }).rows,
    ).toHaveLength(3)
    expect(empty.state.records.size).toBe(0)
  })

  test("a row: ref, title, system, last action and age; ↗ when it opens", () => {
    const rows = texts(sidebarOf("busy", 60).rows)
    expect(rows[0]).toMatch(/^Trail +9$/)
    expect(rows).toContain("COM-1801")
    expect(rows.find((row) => row.startsWith("  PR #33"))).toMatch(
      /^ {2}PR #33 {3}0\.8: Trust, one design s… +GitHub {2}updated {3}1h ↗$/,
    )
    expect(rows.find((row) => row.includes("a1b2c3d"))).toMatch(/created {2}12m$/)
  })

  test("+ N more · /trail counts the records not shown, and is a hit", () => {
    const view = sidebarOf("busy", 42, 4)
    expect(texts(view.rows).at(-1)).toBe("+ 6 more · /trail")
    expect(view.hits.at(-1)).toEqual({ y: view.rows.length - 1, kind: "more" })
  })

  test("a click opens the page, or selects a record that has none", () => {
    const view = sidebarOf("busy", 42)
    const commit = view.hits.find((hit) => hit.kind === "select")
    expect(commit && texts(view.rows)[commit.y]).toContain("a1b2c3d")
    const pr = view.hits.find((hit) => hit.kind === "open" && hit.url.endsWith("/pull/33"))
    expect(pr && texts(view.rows)[pr.y]).toContain("PR #33")
  })

  test("narrow: columns give way before the title does, and a cut says …", () => {
    const narrow = texts(sidebarOf("busy", 30).rows)
    expect(narrow.join("\n")).not.toContain("GitHub")
    expect(narrow.join("\n")).not.toContain("created")
    expect(narrow.find((row) => row.includes("PR #33"))).toContain("…")
    const wide = texts(sidebarOf("busy", 60).rows)
    expect(wide.join("\n")).toContain("GitHub")
  })
})

describe("/trail", () => {
  test("the header names the tabs, the current one marked", () => {
    const view = dialogOf("busy")
    expect(texts(view.rows)[0]).toMatch(
      /^ Trail · opencode-cockpit +\[tab\] {2}This conversation {3}All conversations$/,
    )
    const active = view.rows[0]?.find((run) => run.text === " This conversation ")
    expect(active).toMatchObject({ fill: "chip", bold: true })
    expect(texts(dialogOf("busy", { width: 60 }).rows)[0]).toMatch(/\[tab\] {2}This {3}All$/)
  })

  test("the footer: the keys in the agreed order, esc last", () => {
    const footer = texts(dialogOf("busy", { width: 116 }).rows).at(-1)
    expect(footer).toBe(
      " [enter] Open   [g] Go   [c] Copy   [a] Add   [x] Remove   [/] Search   [m] Markdown   [esc] Close",
    )
    expect(texts(dialogOf("busy", { width: 40 }).rows).at(-1)).toMatch(/… {3}\[esc\] Close$/)
  })

  test("keys follow the cursor: a record without a page cannot open; a find can be added", () => {
    const commit = dialogOf("busy")
    expect(commit.item?.kind).toBe("thing")
    expect(commit.target).toEqual({ copy: "a1b2c3d", remove: "ev_9" })
    const find = commit.items.find((item) => item.kind === "found")
    const onFind = dialogOf("busy", { selected: find?.key })
    expect(onFind.target.add?.url).toBe("https://github.com/acme/web/pull/40")
    const row = texts(onFind.rows).find((text) => text.includes("acme/web/pull/40"))
    expect(row).toMatch(/^▌PR #40 .*GitHub {3}seen 3m {2}\[a\] Add$/)
  })

  test("found-not-recorded rows: only what this conversation has not recorded, and only on This conversation", () => {
    const rows = texts(dialogOf("busy").rows)
    expect(rows).toContain(" FOUND, NOT RECORDED  seen in output — add what this conversation made")
    expect(rows.filter((row) => /seen \d+m {2}\[a\] Add$/.test(row))).toHaveLength(2)
    expect(texts(dialogOf("busy", { tab: "all", height: 60 }).rows).join("\n")).not.toContain("FOUND")
  })

  test("All conversations: each conversation under what it touched; g goes there; a deleted one is marked", () => {
    const view = dialogOf("project", { tab: "all", height: 60, width: 116 })
    const rows = texts(view.rows)
    expect(rows.some((row) => /↳ “Review the 0\.8 branch” .* reviewed +20m$/.test(row))).toBe(true)
    expect(rows.some((row) => row.includes("“Set up the latency dashboard” · deleted"))).toBe(true)
    const touch = view.items.find((item) => item.kind === "touch" && item.touch.session === "ses_review")
    expect(dialogOf("project", { tab: "all", selected: touch?.key }).target).toMatchObject({
      go: "ses_review",
      open: "https://github.com/Codestz/opencode-cockpit/pull/33",
    })
    /** A thing only this conversation touched has no conversation rows: there is nowhere to go. */
    expect(rows.some((row) => row.includes("Status page incident"))).toBe(true)
    expect(
      view.items.filter((item) => item.kind === "touch" && item.thing.title === "Status page incident"),
    ).toEqual([])
  })

  test("a short window keeps the cursor in view and says what is above and below", () => {
    const all = dialogOf("busy", { height: 60 }).items
    const last = all.at(-1)
    const view = dialogOf("busy", { height: 10, selected: last?.key })
    const rows = texts(view.rows)
    expect(rows.find((row) => row.startsWith("▌"))).toContain("COM-1800")
    expect(rows.some((row) => /^ ↑ \d+ more$/.test(row))).toBe(true)
    const top = texts(dialogOf("busy", { height: 10 }).rows)
    expect(top.some((row) => /^ ↓ \d+ more$/.test(row))).toBe(true)
  })

  test("search: the query, how many it kept, and Cancel as the way out while typing", () => {
    const view = dialogOf("busy", { query: "github", searching: true })
    const rows = texts(view.rows)
    expect(rows[1]).toMatch(/^ \[\/\] github▍ +2 of 9$/)
    expect(rows.at(-1)).toBe(" [enter] Done   [esc] Cancel")
    expect(texts(dialogOf("busy", { query: "nothing-like-this" }).rows)).toContain(
      " Nothing matches “nothing-like-this”.",
    )
  })

  test("empty: says so, and how things get here", () => {
    const rows = texts(dialogOf("empty").rows)
    expect(rows[2]).toBe(" Nothing recorded in this conversation yet.")
    expect(rows.join(" ")).toContain("with trail_add")
    expect(dialogOf("empty").item).toBeUndefined()
  })

  test("a subagent's record and one you added say who", () => {
    const rows = texts(dialogOf("busy", { height: 40 }).rows)
    expect(rows.some((row) => row.includes("Rollout checklist · docs"))).toBe(true)
    expect(rows.some((row) => row.includes("Status page incident · you"))).toBe(true)
  })

  test("x removes one conversation's record; in All a thing several touched is removed one at a time", () => {
    const state = emptyState()
    const add = (session: string) =>
      runAdd(
        state,
        { title: "PR", url: "https://github.com/a/b/pull/1" },
        {
          session,
          rootSession: session,
          by: "agent",
          at: SAMPLE_NOW,
        },
      )
    add("s1")
    add("s2")
    const input = { width: 100, height: 20, state, session: "s1", found: [], now: SAMPLE_NOW, project: "p" }
    expect(dialogRows({ ...input, tab: "this" }).target.remove).toBeDefined()
    expect(dialogRows({ ...input, tab: "all" }).target.remove).toBeUndefined()
  })
})
