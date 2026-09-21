#!/usr/bin/env node
/** `npx @opencode-cockpit/updater@latest`: see ./main.ts. */

import { main } from "./main.ts"

process.exitCode = await main(process.argv.slice(2))
