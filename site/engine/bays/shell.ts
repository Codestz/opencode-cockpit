/** Shell: the console (ctrl+x j) over the product's sample shells and their screens, and the sidebar block. */
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import * as samples from "../../../packages/shell/src/cli/samples.ts"
import { consoleRows } from "../../../packages/shell/src/tui/lib/console.ts"
import { sidebarBlock } from "../../../packages/shell/src/tui/lib/sidebar.ts"

const { SHELLS, SAMPLE_LIST, SAMPLE_NOW, SAMPLE_PROJECT, SAMPLE_LOG, DEV_SCREEN, TEST_SCREEN, BUILD_SCREEN } = samples
export const NOW = SAMPLE_NOW
export type Which = "running" | "failed" | "done"

export function screen(which: Which, width: number, height: number, frame: number, now = SAMPLE_NOW) {
  const shell = SHELLS[which]
  const screen = which === "failed" ? TEST_SCREEN : which === "done" ? BUILD_SCREEN : DEV_SCREEN
  return consoleRows({
    shell, now, frame, project: SAMPLE_PROJECT, screen, log: SAMPLE_LOG, view: "screen", up: 0,
    typing: false, colors: true, filter: "", searching: false, draft: "",
    keys: { shell: true, running: which === "running", view: "screen", filtered: false, count: SAMPLE_LIST.length, scope: "session", finished: 3 },
    position: `${SAMPLE_LIST.indexOf(shell) + 1}/${SAMPLE_LIST.length}`, width, height, fill: false,
  } as never)
}

/** The Shells block for any list of shells, at `now`. */
export const sidebar = (list: readonly ShellInfo[], now: number, frame: number, width: number) =>
  sidebarBlock({ list, now, frame, width })

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
