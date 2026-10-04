#!/usr/bin/env bun

/**
 * Writes the `status-setup` skill's reference from the code, so it cannot drift from what Status
 * reads. `test/reference.test.ts` fails when the file on disk is not what this writes.
 *
 *   bun packages/status/src/cli/reference.ts
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { statusReference } from "../core/reference.ts"
import { SETUP_SKILL_DIR } from "../core/setup.ts"

const file = join(SETUP_SKILL_DIR, "references", "settings.md")
writeFileSync(file, statusReference())
console.log(`wrote ${file}`)
