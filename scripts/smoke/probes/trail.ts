/** Trail: its screen opens from the palette, and says so when nothing is recorded yet. */

import { measure } from "../agent.ts"
import { palette } from "../commands.ts"
import { expect, keep, pass, type, under } from "../harness.ts"
import type { Probe } from "../probe.ts"

export const trail: Probe = {
  name: "trail",
  listed: "Show what this conversation made",
  /** From home there is no conversation, so Trail opens on the project's records: none, and says so. */
  async palette() {
    const ran = await palette("Show what this conversation made", 2500)
    await type("\x1b", 1200)
    keep(ran)
    for (const marker of ["Nothing recorded in this project yet.", "[esc] Close"]) {
      expect(ran.includes(marker), `the palette's Trail never drew "${marker}"`, ran)
    }
    pass("trail opened empty")
  },
  empty(drawn) {
    expect(
      under(drawn, "Trail")?.startsWith("none yet"),
      `the sidebar never drew "Trail" with "none yet" under it`,
      drawn,
    )
  },
  /**
   * A turn that opens a PR (with a fake `gh`) records it. Trail's on a free model misses about one
   * turn in six, so it is two of three; the others still one of one.
   */
  measure: (install) => measure(install, "trail", "Trail's", ["--runs", "3", "--pass", "2"]),
}
