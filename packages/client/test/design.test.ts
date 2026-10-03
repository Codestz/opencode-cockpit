import { describe, expect, test } from "bun:test"
import {
  blockShown,
  checkbox,
  closeHint,
  duration,
  EMPTY_TEXT,
  emptyBlock,
  fitHints,
  gaugeTone,
  type Hint,
  type HintRun,
  headingRows,
  hintRuns,
  keyName,
  labelCase,
  STATE_TONE,
  stateMark,
  summaryRuns,
} from "../src/design.ts"

/** The shared grammar: one tone per state, and a key row that keeps its way out and says what it cut. */

const text = (runs: readonly HintRun[]): string => runs.map((run) => run.text).join("")

const row: Hint[] = [
  { key: "tab", label: "Files" },
  { key: "j/k", label: "Navigate" },
  { key: "c", label: "Note Line" },
  { key: "space", label: "Viewed" },
  { key: "b", label: "Source" },
  { key: "B", label: "Base" },
  { key: "w", label: "Width" },
  closeHint(),
]

describe("fitHints", () => {
  test("every width from nothing to roomy is exactly that width", () => {
    for (let width = 0; width <= 140; width++) {
      expect(text(fitHints(row, width).runs).length).toBe(width)
    }
  })

  test("the way out survives every width it can fit in, and is always last", () => {
    for (let width = "…   [esc] Close".length; width <= 140; width++) {
      const said = text(fitHints(row, width).runs).trimEnd()
      expect(said.endsWith("[esc] Close")).toBe(true)
    }
  })

  test("anything dropped is said with … just before the way out", () => {
    for (let width = 20; width <= 140; width++) {
      const fitted = fitHints(row, width)
      const said = text(fitted.runs)
      if (fitted.dropped > 0) expect(said).toContain("…   [esc] Close")
      else expect(said).not.toContain("…")
    }
  })

  test("roomy: everything, in order, nothing dropped", () => {
    const fitted = fitHints(row, 140)
    expect(fitted.dropped).toBe(0)
    expect(text(fitted.runs).trimEnd()).toBe(
      "[tab] Files   [j/k] Navigate   [c] Note Line   [space] Viewed   [b] Source   [B] Base   [w] Width   [esc] Close",
    )
  })

  test("narrow: the least wanted go first, whole, right to left", () => {
    const fitted = fitHints(row, 62)
    expect(text(fitted.runs).trimEnd()).toBe("[tab] Files   [j/k] Navigate   [c] Note Line   …   [esc] Close")
    expect(fitted.dropped).toBe(4)
  })

  test("priority beats position", () => {
    const ranked: Hint[] = [
      { key: "j/k", label: "Select", priority: 1 },
      { key: "enter", label: "Open", priority: 9 },
      { key: "m", label: "Message", priority: 8 },
      closeHint("Back"),
    ]
    expect(text(fitHints(ranked, 43).runs).trimEnd()).toBe("[enter] Open   [m] Message   …   [esc] Back")
  })

  test("too narrow for the way out's label: the key alone, then only the …", () => {
    expect(text(fitHints(row, 9).runs)).toBe("…   [esc]")
    expect(text(fitHints(row, 4).runs)).toBe("…   ")
  })

  test("a hint with nothing to act on is dimmed, not removed", () => {
    const [key, label] = hintRuns({ key: "s", label: "Submit", off: true })
    expect(key).toEqual({ text: "[s]", tone: "muted", faint: true })
    expect(label?.faint).toBe(true)
  })
})

describe("the vocabulary", () => {
  test("named keys are lowercase words; letters keep their case", () => {
    expect(keyName("Tab")).toBe("tab")
    expect(keyName("return")).toBe("enter")
    expect(keyName("Escape")).toBe("esc")
    expect(keyName("B")).toBe("B")
    expect(keyName("j/k")).toBe("j/k")
    expect(keyName("ctrl+]")).toBe("ctrl+]")
    expect(keyName("left/right")).toBe("←/→")
  })

  test("labels are Title Case", () => {
    expect(labelCase("All updates")).toBe("All Updates")
    expect(labelCase("Hide thinking")).toBe("Hide Thinking")
    expect(labelCase("^C")).toBe("^C")
  })

  /** Colour asks something of you: running, needs you, failed. What has simply ended is quiet. */
  test("one tone per state: running is not green, and nothing finished is coloured", () => {
    expect(STATE_TONE.running).toBe("accent")
    expect(STATE_TONE.waiting).toBe("warning")
    expect(STATE_TONE.failed).toBe("error")
    expect(STATE_TONE.done).toBe("muted")
    /** A run you stopped is not a failure. */
    expect(STATE_TONE.stopped).toBe("muted")
  })

  test("a gauge is calm, then a warning, then an error, at two documented thresholds", () => {
    expect(gaugeTone(0.12)).toBe("success")
    expect(gaugeTone(0.13)).toBe("success")
    expect(gaugeTone(0.75)).toBe("warning")
    expect(gaugeTone(0.9)).toBe("error")
    expect(gaugeTone(0.5, 0.4, 0.6)).toBe("warning")
  })

  test("one kind of time: how long it ran", () => {
    expect(duration(4_000)).toBe("4s")
    expect(duration(124_000)).toBe("2m04s")
    expect(duration(1_688_000)).toBe("28m08s")
    expect(duration(4_320_000)).toBe("1h12m")
  })

  test("marks: a spinner while running, a ring while waiting, a dot once ended", () => {
    expect(stateMark("running", 2)).toEqual({ text: "⠹", tone: "accent" })
    expect(stateMark("waiting")).toEqual({ text: "○", tone: "warning" })
    expect(stateMark("failed")).toEqual({ text: "●", tone: "error" })
  })

  test("brackets are keys and checkboxes", () => {
    expect(checkbox(true)).toBe("[✓]")
    expect(checkbox(false)).toBe("[ ]")
  })
})

describe("a block's heading", () => {
  const said = (counts: Parameters<typeof summaryRuns>[0], room = 80) =>
    summaryRuns(counts, room)
      .map((run) => run.text)
      .join("")

  /** It said only the worst — `1 failed` with six done beside it. */
  test("every count, in one order: motion, then endings, failures last", () => {
    expect(said({ done: 6, failed: 1 })).toBe("6 done · 1 failed")
    expect(said({ running: 1, waiting: 1, done: 3, stopped: 1 })).toBe(
      "1 running · 1 needs you · 3 done · 1 stopped",
    )
    expect(said({ done: 7 })).toBe("7 done")
  })

  test("each count in its state's tone", () => {
    const runs = summaryRuns({ running: 2, waiting: 1, done: 4, failed: 1 }, 80).filter(
      (run) => run.text !== " · ",
    )
    expect(runs.map((run) => run.tone)).toEqual(["accent", "warning", "muted", "error"])
  })

  test("narrow: history goes first, what needs you never", () => {
    const counts = { running: 1, waiting: 1, done: 6, failed: 1 }
    expect(said(counts, 34)).toBe("1 running · 1 needs you · 1 failed")
    expect(said(counts, 22)).toBe("1 needs you · 1 failed")
    expect(said(counts, 5)).toBe("1 needs you")
  })
})

/**
 * Presence over silence: an empty block draws its heading and `none yet` in the slot its first item
 * takes, so the first item replaces the line and the blocks below stay where they are.
 */
describe("an empty sidebar block", () => {
  const lines = (rows: readonly (readonly HintRun[])[]) => rows.map((each) => text(each))

  test("is the heading and one muted row, every row exactly the column's width", () => {
    const rows = emptyBlock("Shells", 30)
    expect(lines(rows)).toEqual(["Shells".padEnd(30), " ".repeat(30), EMPTY_TEXT.padEnd(30)])
    expect(rows[0]?.[0]).toMatchObject({ text: "Shells", bold: true })
    expect(rows.at(-1)?.[0]).toMatchObject({ text: "none yet", tone: "muted" })
  })

  test("is as tall as the same block with one single-row item", () => {
    const withOne = [
      ...headingRows("Shells", [{ text: "1 running", tone: "accent" }], 30),
      [{ text: "⠹ dev" }],
    ]
    expect(emptyBlock("Shells", 30)).toHaveLength(withOne.length)
  })

  test("draws nothing when asked to hide, and only when empty", () => {
    expect(emptyBlock("Shells", 30, true)).toEqual([])
    expect(blockShown(0, true)).toBe(false)
    expect(blockShown(0)).toBe(true)
    expect(blockShown(1, true)).toBe(true)
  })

  test("a heading keeps its summary only while there is room, and never runs past the column", () => {
    const summary = [{ text: "2 running", tone: "accent" as const }]
    expect(lines(headingRows("Subagents", summary, 24))[0]).toBe("Subagents      2 running")
    expect(lines(headingRows("Subagents", summary, 18))[0]).toBe("Subagents         ")
    expect(lines(headingRows("Subagents", [], 6))[0]).toBe("Subag…")
    expect(lines(emptyBlock("Trail", 4)).every((each) => each.length === 4)).toBe(true)
  })
})
