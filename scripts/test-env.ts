/**
 * Preloaded by `bun test` (bunfig.toml). Features started in tests log like real ones, and without
 * this their lines landed in the developer's own `~/.cache/opencode-cockpit/cockpit.log`.
 */
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.COCKPIT_LOG_FILE ??= join(tmpdir(), `cockpit-test-${process.pid}.log`)
