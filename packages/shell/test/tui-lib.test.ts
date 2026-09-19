import { describe, expect, test } from "bun:test"
import type { ScreenRun, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { friendlyError, splitMatches } from "../src/tui/lib/search.ts"
import {
  BADGE_LABEL,
  badgeText,
  kindColor,
  SPINNER,
  shortDetail,
  since,
  statusDetail,
  tailLines,
  tailRuns,
  truncate,
  watchColor,
  watchLabel,
} from "../src/tui/lib/view.ts"

let seq = 0
const shell = (over: Partial<ShellInfo>): ShellInfo => ({
  id: `sh_${String(seq++).padStart(8, "a")}`,
  title: "t",
  command: "/bin/zsh",
  args: ["-c", "npm test"],
  cwd: "/p",
  owner: { project: "/p" },
  status: "running",
  run: 1,
  startedAt: 1000,
  cols: 80,
  rows: 24,
  lines: { first: 1, last: 0 },
  bytes: 0,
  ...over,
})

const theme = {
  success: "#0f0",
  error: "#f00",
  warning: "#ff0",
  textMuted: "#888",
} as unknown as Parameters<typeof kindColor>[0]

describe("badges", () => {
  // The panel lines badges up in a fixed column; a badge that is one cell wider shears the list.
  test("every badge occupies the same seven cells", () => {
    for (const kind of ["run", "fail", "stop", "done"] as const) {
      expect(badgeText(kind).length).toBe(7)
    }
  })

  test("the spinner advances and wraps", () => {
    expect(badgeText("run", 0)).toBe(`▌ ${SPINNER[0]} RUN`)
    expect(badgeText("run", 1)).toBe(`▌ ${SPINNER[1]} RUN`)
    expect(badgeText("run", SPINNER.length)).toBe(badgeText("run", 0))
    expect(badgeText("run", SPINNER.length * 3 + 4)).toBe(badgeText("run", 4))
  })

  test("finished badges do not spin", () => {
    expect(badgeText("done", 7)).toBe(badgeText("done", 0))
    expect(badgeText("fail", 0).replace("▌", "").trim()).toBe(BADGE_LABEL.fail)
  })

  // The rule is its own leading column so it can be coloured apart from the label.
  test("every badge starts with the rule", () => {
    for (const kind of ["run", "fail", "stop", "done"] as const) {
      expect(badgeText(kind).startsWith("▌")).toBe(true)
    }
  })

  test("colour follows meaning, not status", () => {
    expect(kindColor(theme, "run")).toBe(theme.success)
    expect(kindColor(theme, "fail")).toBe(theme.error)
    expect(kindColor(theme, "stop")).toBe(theme.warning)
    expect(kindColor(theme, "done")).toBe(theme.textMuted)
  })
})

describe("stop reasons read as sentences", () => {
  const stopped = (over: Partial<ShellInfo>) =>
    statusDetail(shell({ status: "killed", startedAt: 0, endedAt: 5000, ...over }), 5000)

  test("each reason has its own words", () => {
    expect(stopped({ stopReason: "timeout" })).toStartWith("timed out after")
    expect(stopped({ stopReason: "idle" })).toStartWith("idle-stopped after")
    expect(stopped({ stopReason: "shutdown" })).toStartWith("daemon stopped it after")
  })

  // Same reason, different actor: the panel says who, because "stopped" alone is a mystery.
  test("a requested stop names whoever asked for it", () => {
    expect(stopped({ stopReason: "request", stoppedBy: "tui:inst" })).toStartWith("you stopped it")
    expect(stopped({ stopReason: "request", stoppedBy: "agent:ses_1" })).toStartWith("agent stopped it")
    expect(stopped({ stopReason: "request" })).toStartWith("agent stopped it")
  })

  test("an unknown reason still reads", () => {
    expect(stopped({})).toStartWith("stopped after")
  })

  test("a shell that never started says so instead of showing exit ?", () => {
    expect(statusDetail(shell({ status: "failed", endedAt: 2000 }), 2000)).toBe("could not start")
  })

  test("a non-zero exit shows the code", () => {
    expect(
      statusDetail(shell({ status: "exited", exitCode: 3, startedAt: 0, endedAt: 1000 }), 1000),
    ).toStartWith("exit 3 after")
  })
})

describe("compact detail", () => {
  test("says the one thing that fits", () => {
    expect(shortDetail(shell({ startedAt: 0 }), 5000)).toBe("5s")
    expect(shortDetail(shell({ status: "failed" }), 0)).toBe("no start")
    expect(shortDetail(shell({ status: "exited", exitCode: 2 }), 0)).toBe("exit 2")
    expect(shortDetail(shell({ status: "killed" }), 0)).toBe("stopped")
    expect(shortDetail(shell({ status: "exited", exitCode: 0, endedAt: 1000 }), 61_000)).toBe("1m ago")
  })

  test("a finished shell with no end time still reads", () => {
    expect(shortDetail(shell({ status: "exited", exitCode: 0 }), 1000)).toBe("done")
  })
})

describe("relative time", () => {
  test("coarsens as it ages", () => {
    expect(since(0)).toBe("just now")
    expect(since(4999)).toBe("just now")
    expect(since(5000)).toBe("5s ago")
    expect(since(59_000)).toBe("59s ago")
    expect(since(60_000)).toBe("1m ago")
    expect(since(3_599_000)).toBe("59m ago")
    expect(since(3_600_000)).toBe("1h ago")
    expect(since(86_399_000)).toBe("23h ago")
    expect(since(86_400_000)).toBe("1d ago")
  })
})

describe("watch labels", () => {
  test("nothing to say while a watch is still pending", () => {
    expect(watchLabel(shell({}))).toBe("")
    expect(watchLabel(shell({ watch: { status: "pending" } }))).toBe("")
  })

  test("the preset names itself and carries its mark", () => {
    expect(watchLabel(shell({ watch: { status: "ok", preset: "tsc" } }))).toBe("tsc ✓")
    expect(watchLabel(shell({ watch: { status: "fail", preset: "tsc" } }))).toBe("tsc ✗")
  })

  test("a rule without a preset is still labelled", () => {
    expect(watchLabel(shell({ watch: { status: "ok" } }))).toBe("watch ✓")
    expect(watchLabel(shell({ watch: { status: "unknown" } }))).toBe("watch ?")
  })

  test("colour matches the mark", () => {
    expect(watchColor(theme, shell({ watch: { status: "ok" } }))).toBe(theme.success)
    expect(watchColor(theme, shell({ watch: { status: "fail" } }))).toBe(theme.error)
    expect(watchColor(theme, shell({}))).toBe(theme.textMuted)
  })
})

describe("trimming output to the panel", () => {
  const text = ["one", "two", "three", "four"].join("\n")

  test("keeps the last rows", () => {
    expect(tailLines(text, 2, 80)).toBe("three\nfour")
    expect(tailLines(text, 99, 80)).toBe(text)
    expect(tailLines(undefined, 2, 80)).toBe("")
  })

  test("cuts long lines with an ellipsis, never past the width", () => {
    const out = tailLines("abcdefghij", 1, 5)
    expect(out).toBe("abcd…")
    expect(out.length).toBe(5)
  })

  // A zero-width panel happens for one frame while the console is being laid out.
  test("survives a zero width", () => {
    expect(tailLines("abc", 1, 0)).toBe("…")
  })

  test("truncate leaves short text alone", () => {
    expect(truncate("abc", 10)).toBe("abc")
    expect(truncate("abcdef", 4)).toBe("abc…")
  })
})

describe("styled tails keep colour aligned with text", () => {
  const row = (...runs: [string, string][]): ScreenRun[] =>
    runs.map(([text, fg]) => ({ text, fg }) as unknown as ScreenRun)

  test("keeps the last rows", () => {
    const styled = [row(["a", "#111"]), row(["b", "#222"]), row(["c", "#333"])]
    const out = tailRuns(styled, 2, 80)
    expect(out.map((r) => r.map((s) => s.text).join(""))).toEqual(["b", "c"])
    expect(out).toHaveLength(2)
  })

  // The bug this guards: cutting text by column while styles are cut by run index, which paints
  // the wrong colours from the cut onwards.
  test("cuts mid-run and drops what lies past the width, style and all", () => {
    const out = tailRuns([row(["hello", "#f00"], [" world", "#0f0"])], 1, 7)
    expect(out[0]).toEqual([
      { text: "hello", fg: "#f00" },
      { text: " w", fg: "#0f0" },
    ] as unknown as ScreenRun[])
    expect((out[0] as ScreenRun[]).map((r) => r.text).join("").length).toBe(7)
  })

  test("no styles means no rows", () => {
    expect(tailRuns(undefined, 5, 80)).toEqual([])
  })
})

describe("log search", () => {
  test("an empty query is one unmatched span", () => {
    expect(splitMatches("hello", "")).toEqual([{ text: "hello", match: false }])
  })

  test("splits around every hit", () => {
    expect(splitMatches("a-b-a", "a")).toEqual([
      { text: "a", match: true },
      { text: "-b-", match: false },
      { text: "a", match: true },
    ])
  })

  test("matches case-insensitively but keeps the original casing", () => {
    expect(splitMatches("Error: ERROR", "error")).toEqual([
      { text: "Error", match: true },
      { text: ": ", match: false },
      { text: "ERROR", match: true },
    ])
  })

  test("a query that does not appear leaves the text whole", () => {
    expect(splitMatches("hello", "zzz")).toEqual([{ text: "hello", match: false }])
  })

  // Empty text with a query used to produce zero spans, which renders as a missing line.
  test("empty text still yields a span", () => {
    expect(splitMatches("", "a")).toEqual([{ text: "", match: false }])
  })
})

describe("errors are rewritten for humans", () => {
  test("daemon wording becomes plain language", () => {
    expect(friendlyError(new Error("shell sh_a is exited"))).toBe("the shell is no longer running")
    expect(friendlyError(new Error("shell sh_a is killed"))).toBe("the shell is no longer running")
    expect(friendlyError(new Error("sh_a not found"))).toBe("that shell was already removed")
    expect(friendlyError(new Error("cockpitd is not running (/tmp/x.sock)"))).toBe(
      "lost connection to cockpitd, retrying",
    )
  })

  test("anything else is passed through, whatever was thrown", () => {
    expect(friendlyError(new Error("disk is full"))).toBe("disk is full")
    expect(friendlyError("plain string")).toBe("plain string")
  })
})
