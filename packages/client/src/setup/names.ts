/** The names setup is reached by, shared by the agent side and the interface's palette entry. */

import { fileURLToPath } from "node:url"

/** The skill, the command that loads it, and the line the command sends. */
export const SETUP_SKILL = "cockpit-setup"
export const SETUP_SLASH = "cockpit-setup"
export const SETUP_PROMPT = "Use the cockpit-setup skill to help me set up Cockpit."
export const SETTINGS_TOOL = "cockpit_settings"
export const CONVENTIONS_TOOL = "cockpit_conventions"

/** Where the skill sits in this package: `src/setup/` and `dist/setup/` are both two levels under its root. */
export const SETUP_SKILL_DIR = fileURLToPath(new URL(`../../skills/${SETUP_SKILL}`, import.meta.url))
