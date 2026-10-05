/**
 * Review: the panel draws the project's uncommitted change and names a setting from before 0.9, and
 * the palette opens it full screen.
 */

import { measure } from "../agent.ts"
import { palette } from "../commands.ts"
import { expect, keep, pass, screen, type } from "../harness.ts"
import type { Probe } from "../probe.ts"

export const review: Probe = {
  name: "review",
  listed: "Open or close the changes",
  /**
   * The review panel, from the same published build.
   *
   * It reads the repository rather than the session, so the project is a real checkout with one
   * uncommitted change — and the file is named for this test, so a panel that draws *something*
   * cannot pass for a panel that drew the diff.
   */
  async open() {
    await type("\x18v", 3000)
    const drawn = await screen()
    await type("\x18v", 1500) // close the review again
    keep(drawn)
    for (const [what, marker] of [
      ["the review panel never drew", "review"],
      ["the review panel drew no diff", "SMOKE-REVIEW"],
      ["the review panel never named its broken setting", '"review.source" should be'],
    ] as const) {
      expect(drawn.includes(marker), what, drawn)
    }
    pass("review drew its diff and named its broken setting")
  },
  /** Palette-only: closed, it used to change nothing on screen; now it opens, full screen. */
  async palette() {
    const ran = await palette("Toggle the changes full screen", 3000)
    /** Each surface is closed before the next: an open review takes the keys, `ctrl+p` included. */
    await type("\x1b", 1200)
    keep(ran)
    expect(ran.includes("SMOKE-REVIEW"), "the palette's full-screen toggle never opened the changes", ran)
    /** Full screen puts the header on the top row; the pane leaves it to the conversation. */
    expect(
      ran.split("\n")[0]?.includes("review"),
      "the palette's toggle opened the changes, but not full screen",
      ran,
    )
  },
  ask: { call: "review_list", tool: "review_list", heading: "## Review comments" },
  /** A waiting comment is read with review_list and answered with review_reply. */
  measure: (install) => measure(install, "review", "Review's", ["--runs", "1"]),
}
