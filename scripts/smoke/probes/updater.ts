/** The updater: its dialog opens from the palette and by its slash name. */

import { palette, slash } from "../commands.ts"
import { expect, keep, pass, type, v2 } from "../harness.ts"
import type { Probe } from "../probe.ts"

/** OpenCode 2 updates plugins itself; there the commands point at it instead of opening the dialog. */
const drewDialog = (what: string, text: string) => {
  for (const marker of v2 ? ["change the version"] : ["Plugins", "published", "local", "Review"]) {
    expect(text.includes(marker), `${what} did not draw "${marker}"`, text)
  }
}

export const updater: Probe = {
  name: "updater",
  listed: "Update plugins",
  async palette() {
    const ran = await palette("Update plugins", 4000)
    await type("\x1b", 1200)
    keep(ran)
    drewDialog("the palette's Update plugins", ran)
  },
  /**
   * The updater's dialog, opened by its slash name and by the old one it replaced — two slash names
   * for one surface is exactly what docs/opencode/keys-and-commands.md warns can break the popup.
   * Every plugin here is a local path, so the list must say so, and nothing may be written.
   */
  async slash() {
    const drawn = await slash("plugins-update")
    keep(drawn)
    // `SMOKE_SHOW=1 bun run smoke:tui` prints the updater's frame: a marker proves it drew, not how.
    if (process.env.SMOKE_SHOW) console.log(drawn)
    drewDialog("/plugins-update", drawn)
    pass("updater answered its slash name")
  },
}
