/** Trust: its sidebar toggle says what it did, and its ledger opens, from the palette. */

import { palette } from "../commands.ts"
import { expect, keep, type } from "../harness.ts"
import type { Probe } from "../probe.ts"

export const trust: Probe = {
  name: "trust",
  listed: "Show what Trust answers for you",
  async palette() {
    const toggled = await palette("Show or hide Trust in the sidebar", 1200)
    const ledger = await palette("Show what Trust answers for you", 2500)
    await type("\x1b", 1200)
    keep(toggled, ledger)
    expect(
      toggled.includes("Shown in the sidebar."),
      "the palette's Trust sidebar toggle said nothing",
      toggled,
    )
    /** /trust opens on the ledger, today's answers one row above it and the activity behind `a`. */
    expect(
      ledger.includes("Today") && ledger.includes("[a] Activity"),
      "the palette never opened Trust's ledger",
      ledger,
    )
  },
}
