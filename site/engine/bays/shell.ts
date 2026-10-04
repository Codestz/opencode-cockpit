/** Shell: the console (ctrl+x j) over the product's sample shells and their screens, and the sidebar block. */
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import * as samples from "../../../packages/shell/src/cli/samples.ts"
import { consoleRows } from "../../../packages/shell/src/tui/lib/console.ts"
import { sidebarBlock } from "../../../packages/shell/src/tui/lib/sidebar.ts"

const { SHELLS, SAMPLE_LIST, SAMPLE_NOW, SAMPLE_PROJECT, SAMPLE_LOG, DEV_SCREEN, TEST_SCREEN, BUILD_SCREEN } = samples
export const NOW = SAMPLE_NOW

type Screen = typeof DEV_SCREEN
type Styled = NonNullable<Screen["styled"]>[number]

/** A test run long enough to watch scroll: passing files, then the sample's own failure and summary. */
const TEST_RUN: Screen = (() => {
  const passing = ["cart/total", "cart/discount", "cart/tax", "checkout/address", "checkout/payment", "checkout/review", "auth/login", "auth/logout", "auth/refresh", "api/orders", "api/products", "api/users", "ui/button", "ui/modal", "ui/table"]
  const lines = [
    ...passing.map((f, i) => ` ✓ src/${f}.test.ts (${4 + ((i * 7) % 11)} tests) ${9 + ((i * 13) % 40)}ms`),
    ...TEST_SCREEN.text.split("\n").slice(2),
  ]
  return { ...TEST_SCREEN, text: lines.join("\n") }
})()

const SCREENS = { running: DEV_SCREEN, failed: TEST_RUN, done: BUILD_SCREEN } as const
export type Which = keyof typeof SCREENS

/** How many lines each program prints before it settles. */
export const length = (which: Which) => SCREENS[which].text.split("\n").length

/**
 * The screen after `k` lines have arrived — the way a terminal fills, and scrolls once it is full.
 * A program's own colours (the dev server's) are kept with their lines.
 */
function reveal(screen: Screen, k: number): Screen {
  const text = screen.text.split("\n")
  const from = Math.max(0, Math.min(k, text.length) - screen.rows)
  const to = Math.min(k, text.length)
  const styled = screen.styled?.slice(from, to) as Styled[] | undefined
  return { ...screen, text: text.slice(from, to).join("\n"), ...(styled ? { styled } : {}), cursor: { x: 0, y: Math.max(0, to - from - 1) } }
}

/**
 * The console (ctrl+x j) on one of the sample shells, `k` lines into its output. Until its output is
 * all there, a shell that will fail or finish is still running — the badge and the keys say so.
 */
export function screen(which: Which, width: number, height: number, frame: number, now = SAMPLE_NOW, k = Number.POSITIVE_INFINITY) {
  const settled = k >= length(which)
  const shell = settled || which === "running" ? SHELLS[which] : { ...SHELLS[which], status: "running", exitCode: undefined, endedAt: undefined, summary: undefined, pid: 4400 }
  return consoleRows({
    shell, now, frame, project: SAMPLE_PROJECT, screen: reveal(SCREENS[which], k), log: SAMPLE_LOG, view: "screen", up: 0,
    typing: false, colors: true, filter: "", searching: false, draft: "",
    keys: { shell: true, running: shell.status === "running", view: "screen", filtered: false, count: SAMPLE_LIST.length, scope: "session", finished: 3 },
    position: `${SAMPLE_LIST.indexOf(SHELLS[which]) + 1}/${SAMPLE_LIST.length}`, width, height, fill: false,
  } as never)
}

/** The Shells block for any list of shells, at `now`. */
export const sidebar = (list: readonly ShellInfo[], now: number, frame: number, width: number, hideWhenEmpty = false) =>
  sidebarBlock({ list, now, frame, width, hideWhenEmpty })

/**
 * The console's log view of the dev server, as search leaves it: `/` and a query being typed
 * (`draft`), or the log filtered to it, matches lit — what the console does with SAMPLE_LOG.
 */
export function log(width: number, height: number, frame: number, search: { draft?: string; filter?: string }) {
  const filter = search.filter ?? ""
  const searching = search.draft !== undefined
  return consoleRows({
    shell: SHELLS.running, now: SAMPLE_NOW, frame, project: SAMPLE_PROJECT, screen: DEV_SCREEN,
    log: filter ? SAMPLE_LOG.filter((line) => line.text.includes(filter)) : SAMPLE_LOG,
    view: "log", up: 0, typing: false, colors: true, filter, searching, draft: search.draft ?? "",
    keys: { shell: true, running: true, view: "log", filtered: Boolean(filter), count: SAMPLE_LIST.length, scope: "session", finished: 3 },
    position: `${SAMPLE_LIST.indexOf(SHELLS.running) + 1}/${SAMPLE_LIST.length}`, width, height, fill: false,
  } as never)
}

/** A sample shell to build a scripted one from: a dev server, its type checker healthy. */
export const devServer = (startedAt: number): ShellInfo => ({
  ...SHELLS.running,
  startedAt,
  watch: { preset: "tsc", status: "ok", runs: 4, since: startedAt },
})

/** A test run, as the hero scripts it: running, then exited — failed with its line, or passed. */
export function testRun(run: number, startedAt: number, ended?: { at: number; failed?: string }): ShellInfo {
  return {
    ...SHELLS.done,
    id: "sh_test",
    title: "bun test",
    args: ["-c", "bun test"],
    run,
    startedAt,
    ...(ended
      ? { status: "exited", exitCode: ended.failed ? 1 : 0, endedAt: ended.at, ...(ended.failed ? { summary: ended.failed } : {}) }
      : { status: "running", exitCode: undefined, endedAt: undefined, pid: 4300 + run }),
  }
}
