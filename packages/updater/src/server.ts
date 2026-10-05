/**
 * Published entry point: `@opencode-cockpit/updater/server` — an agent half with nothing of its own, since
 * the updater works from the interface and its CLI.
 *
 * It exists for OpenCode 2, which sets up a plugin's interface only once its agent half has loaded:
 * listed in `opencode.json`, as `opencode plugin add` writes it, a Updater with no agent half loaded
 * nothing at all (measured on 2.0.18). Like every Cockpit agent half, it offers `/cockpit-setup`.
 */

import { dualServer } from "@opencode-cockpit/client/server"

export default dualServer("opencode-cockpit.updater", async () => ({}))
