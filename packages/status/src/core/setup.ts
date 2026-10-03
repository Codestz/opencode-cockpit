/**
 * Setting Status up with the agent: the `status-setup` skill and the commands that load it.
 *
 * Designing a line is an editing job in a file the interface never names, judged in a terminal, so
 * the agent does it with the person. The flow, the presets, every segment and the design rules are
 * the skill, shipped in this package (`skills/status-setup`) and written partly from the code
 * (`references/settings.md`, `bun packages/status/src/cli/reference.ts`). What the files say right now
 * is `cockpit_settings`, the one tool every Cockpit install has.
 */

import { fileURLToPath } from "node:url"

export const SETUP_SKILL = "status-setup"
/** The command, by the name it has had since 0.9. */
export const SETUP_SLASH = "status-setup"
/** Its name until 0.9, kept one release as a command that says the new one. Removed in 0.10. */
export const OLD_SLASH = "statusline"

/** What either command, and the palette, hands the agent. */
export const SETUP_PROMPT = "Use the status-setup skill to help me set up the Status bay."
/** The old name says its new one where the person reads it: first in the line it sends. */
export const OLD_PROMPT = `/${OLD_SLASH} is now /${SETUP_SLASH}. ${SETUP_PROMPT}`

/** Where the skill sits in this package: `src/core/` and `dist/core/` are both two levels under its root. */
export const SETUP_SKILL_DIR = fileURLToPath(new URL(`../../skills/${SETUP_SKILL}`, import.meta.url))
