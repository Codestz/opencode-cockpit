#!/usr/bin/env bun

/**
 * Writes the `cockpit-setup` skill's settings reference from the code, so it cannot drift from what
 * the bays read. `test/catalog.test.ts` fails when the file on disk is not what this writes.
 *
 *   bun packages/client/src/cli/reference.ts
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { settingsReference } from "../settings/catalog.ts"
import { SETUP_SKILL_DIR } from "../setup/index.ts"

const file = join(SETUP_SKILL_DIR, "references", "settings.md")
writeFileSync(file, settingsReference())
console.log(`wrote ${file}`)
