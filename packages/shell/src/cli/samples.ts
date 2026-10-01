/**
 * Shells to draw against with no daemon and no OpenCode: one of every kind, and the cases that
 * break a layout — a title longer than any column, a watcher still pending, a failure whose reason
 * runs to three lines.
 */

import type { LogLine, ScreenResult, ScreenRun, ShellInfo } from "@opencode-cockpit/protocol/shell"

/** When the dev server started: a real date, so the details' `started` row reads like one. */
const T0 = Date.UTC(2026, 8, 30, 14, 0, 0)
/** Five minutes after the dev server started; every time below is measured from `T0`. */
export const SAMPLE_NOW = T0 + 300_000
export const SAMPLE_PROJECT = "/Users/you/code/web"

const base: ShellInfo = {
  id: "sh_dev",
  title: "bun run dev",
  command: "/bin/zsh",
  args: ["-c", "bun run dev --port 3000"],
  cwd: SAMPLE_PROJECT,
  owner: { project: SAMPLE_PROJECT, session: "ses_1" },
  status: "running",
  run: 1,
  startedAt: T0,
  cols: 80,
  rows: 24,
  lines: { first: 1, last: 120 },
  bytes: 40_960,
}

export const SHELLS = {
  /** A dev server with a type-checker watching it, which has just found errors. */
  running: {
    ...base,
    pid: 4242,
    watch: { preset: "tsc", status: "fail", runs: 3, since: T0 + 280_000, summary: "Found 2 errors." },
  },
  /** A watcher that has not finished its first run: still unmistakably a watcher. */
  watching: {
    ...base,
    id: "sh_tsc",
    title: "tsc --watch",
    args: ["-c", "bunx tsc --watch --noEmit"],
    cwd: `${SAMPLE_PROJECT}/packages/api`,
    pid: 4250,
    startedAt: T0 + 290_000,
    watch: { preset: "tsc", status: "pending", runs: 0, since: T0 + 290_000 },
  },
  /** A test run that failed, with a title longer than any sidebar and a reason longer than a line. */
  failed: {
    ...base,
    id: "sh_test",
    title: "npm run test -- --coverage --reporter=verbose",
    args: ["-c", "npm run test -- --coverage --reporter=verbose"],
    status: "exited",
    exitCode: 1,
    run: 2,
    startedAt: T0 + 60_000,
    endedAt: T0 + 92_000,
    summary:
      "FAIL src/auth/session.test.ts > creates a session > rejects an expired token: expected 401 to be 403 — the middleware ran before the clock was mocked",
  },
  /** Stopped by hand, part way. */
  stopped: {
    ...base,
    id: "sh_db",
    title: "docker compose up db",
    args: ["-c", "docker compose up db"],
    status: "killed",
    stopReason: "request",
    stoppedBy: "tui",
    startedAt: T0 + 20_000,
    endedAt: T0 + 200_000,
  },
  /** Finished cleanly a few minutes ago. */
  done: {
    ...base,
    id: "sh_build",
    title: "bun run build",
    args: ["-c", "bun run build"],
    status: "exited",
    exitCode: 0,
    startedAt: T0 + 10_000,
    endedAt: T0 + 55_000,
  },
} satisfies Record<string, ShellInfo>

/** The order the sidebar and the dock rank them in: running, then failures, then the rest. */
export const SAMPLE_LIST: ShellInfo[] = [
  SHELLS.running,
  SHELLS.watching,
  SHELLS.failed,
  SHELLS.stopped,
  SHELLS.done,
]

const vite = (i: number): ScreenRun[] => [
  { text: "12:04:1" },
  { text: String(i % 10) },
  { text: " PM " },
  { text: "[vite]", fg: "#56b6c2", bold: true },
  { text: " hmr update ", fg: "#7fd88f" },
  { text: `/src/routes/app${i}.tsx`, fg: "#808080" },
]

/** What a dev server's screen looks like: a banner, then a stream of updates, in its own colours. */
export const DEV_SCREEN: ScreenResult = (() => {
  const styled: ScreenRun[][] = [
    [{ text: "  VITE v6.0.3", fg: "#7fd88f", bold: true }, { text: "  ready in 412 ms" }],
    [],
    [{ text: "  ➜  Local:   " }, { text: "http://localhost:3000/", fg: "#56b6c2" }],
    [],
    ...Array.from({ length: 24 }, (_, i) => vite(i)),
  ]
  return {
    text: styled.map((row) => row.map((run) => run.text).join("")).join("\n"),
    styled,
    cols: 80,
    rows: 24,
    cursor: { x: 0, y: 23 },
  }
})()

/** A test runner's last screen. */
export const TEST_SCREEN: ScreenResult = (() => {
  const lines = [
    " ✓ src/cart/total.test.ts (12 tests) 31ms",
    " ✓ src/cart/discount.test.ts (8 tests) 12ms",
    " ✗ src/auth/session.test.ts > creates a session > rejects an expired token",
    "   AssertionError: expected 401 to be 403",
    "",
    " Test Files  1 failed | 23 passed (24)",
    "      Tests  1 failed | 211 passed (212)",
  ]
  return { text: lines.join("\n"), cols: 80, rows: 24, cursor: { x: 0, y: 6 } }
})()

/** A build's last screen. */
export const BUILD_SCREEN: ScreenResult = (() => {
  const lines = [
    "$ vite build",
    "vite v6.0.3 building for production...",
    "✓ 412 modules transformed.",
    "dist/index.html                  0.46 kB │ gzip:  0.30 kB",
    "dist/assets/index-4f2a1c.css    18.20 kB │ gzip:  4.12 kB",
    "dist/assets/index-9b7d3e.js    212.84 kB │ gzip: 68.31 kB",
    "✓ built in 41.2s",
  ]
  return { text: lines.join("\n"), cols: 80, rows: 24, cursor: { x: 0, y: 6 } }
})()

export const SAMPLE_LOG: LogLine[] = DEV_SCREEN.text.split("\n").map((text, i) => ({ n: i + 1, text }))
