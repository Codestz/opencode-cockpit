/**
 * Shell: a background shell started from the palette keeps its panel updating, and its console opens
 * — in the dialog and full screen.
 *
 * Why it exists: OpenCode only Solid-compiles plugin JSX outside `node_modules`, so a published
 * plugin can load, log, and talk to the daemon while rendering exactly one frozen frame (0.1.3 and
 * 0.1.4 shipped that way).
 */

import { measure } from "../agent.ts"
import { expect, keep, pass, screen, type, under } from "../harness.ts"
import type { Probe } from "../probe.ts"

const ticks = (text: string) => [...text.matchAll(/tick (\d+)/g)].map((m) => Number(m[1]))

export const shell: Probe = {
  name: "shell",
  listed: "Start a background shell",
  async open() {
    await type("\x10", 1000) // ctrl+p command palette
    await type("Start a background shell", 1200)
    await type("\r", 1200)
    await type("i=0; while true; do i=$((i+1)); echo tick $i; sleep 1; done", 300)
    await type("\r", 3500)

    const first = await screen()
    await Bun.sleep(4000)
    const second = await screen()

    /**
     * The console, which was never opened here — so a crash on open was never caught here either.
     * Pressing `?` walks both halves of the key row: the keys that act, and the rest in the panel.
     */
    await type("\x18j", 3000) // ctrl+x j
    const consoleScreen = await screen()
    await type("?", 1500)
    const consoleDetails = await screen()
    await type("\x1b", 800) // esc, back to the conversation

    /**
     * Full screen, which neither version's run opened before — so on OpenCode 2 it could draw nothing
     * and still pass. `w` swaps the dialog for it and is remembered, so it is swapped back before leaving.
     */
    await type("\x18j", 3000)
    await type("w", 2500)
    const fullScreen = await screen()
    await type("w", 1500)
    await type("\x1b", 800)
    keep(first, second, consoleScreen, fullScreen)
    if (process.env.SMOKE_SHOW) console.log(fullScreen)

    const firstMax = Math.max(0, ...ticks(first))
    const secondMax = Math.max(0, ...ticks(second))
    expect(firstMax > 0, "the panel never showed the shell's output", first)
    expect(
      secondMax > firstMax,
      `the panel froze: still at tick ${firstMax} after 4s (published JSX not Solid-compiled?)`,
      second,
    )
    pass(`panel live, tick ${firstMax} → ${secondMax}`)

    for (const [what, marker] of [
      ["the console never drew its keys", "[?]"],
      ["the console's action keys never drew", "[r]"],
    ] as const) {
      expect(consoleScreen.includes(marker), what, consoleScreen)
    }
    expect(consoleDetails.includes("keys"), "the details panel never listed the other keys", consoleDetails)
    pass("console and its keys drew")
    /** The dialog sits inside the host's frame; only full screen puts the header on the top row. */
    expect(
      fullScreen.split("\n")[0]?.includes("RUN") && /^ {2}│ tick \d+/m.test(fullScreen),
      "full screen never drew the console across the window",
      fullScreen,
    )
    pass("full screen drew")
  },
  empty(drawn) {
    expect(
      under(drawn, "Shells")?.startsWith("none yet"),
      `the sidebar never drew "Shells" with "none yet" under it`,
      drawn,
    )
  },
  ask: {
    call: "the tool shell_start with command 'echo AGENT-SHELL-OK' and description 'agent probe'",
    tool: "shell_start",
    heading: "## Background shells",
  },
  /** "start the dev server" goes in shell_start, and a second conversation reuses it rather than starting another. */
  measure: (install) => measure(install, "shell", "Shell's", ["--runs", "1"]),
}
