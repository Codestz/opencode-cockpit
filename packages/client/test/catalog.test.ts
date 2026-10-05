import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readSkill } from "../src/opencode/server/index.ts"
import { BAY_ABOUT, bayKeys, settingsReference } from "../src/settings/catalog.ts"
import { BAYS, SHARED_DEFAULTS } from "../src/settings/index.ts"
import {
  CONVENTIONS_TOOL,
  HOST_BLOCKS,
  SETTINGS_TOOL,
  SETUP_SKILL,
  SETUP_SKILL_DIR,
  settingsReport,
} from "../src/setup/index.ts"

/**
 * The `cockpit-setup` skill is static text shipped beside code that changes. These are what keep it
 * honest: its reference is exactly what the catalog writes, every starting point it offers is a file
 * the loader reads without a notice, and the names it uses are the code's.
 */

const skill = readFileSync(join(SETUP_SKILL_DIR, "SKILL.md"), "utf8")
const reference = readFileSync(join(SETUP_SKILL_DIR, "references", "settings.md"), "utf8")

describe("the reference", () => {
  test("is what the catalog writes — run `bun packages/client/src/cli/reference.ts` when it is not", () => {
    expect(reference).toBe(settingsReference())
  })

  test("every bay has a section, and every shared default is the loader's", () => {
    for (const bay of BAYS) {
      expect(reference).toContain(`## \`${bay}\` — ${BAY_ABOUT[bay]}`)
      for (const info of bayKeys(bay)) {
        if (info.key in SHARED_DEFAULTS[bay] && info.key !== "keybinds" && !info.defaultText)
          expect(info.default).toEqual(
            SHARED_DEFAULTS[bay][info.key as keyof (typeof SHARED_DEFAULTS)[typeof bay]],
          )
      }
    }
  })
})

describe("the skill", () => {
  test("is named for the command, and its description says when to use it", () => {
    const read = readSkill({ dir: SETUP_SKILL_DIR })
    expect(read?.name).toBe(SETUP_SKILL)
    const description = read?.description ?? ""
    expect(description.length).toBeLessThan(1024)
    for (const trigger of [
      "/cockpit-setup",
      "sidebar",
      "quieter",
      "hide the shells block",
      "configure cockpit",
    ])
      expect(description).toContain(trigger)
  })

  test("calls the tool by its name, and points at a reference that exists", () => {
    expect(skill).toContain(`\`${SETTINGS_TOOL}\``)
    expect(skill).toContain("(references/settings.md)")
  })

  test("names OpenCode's own blocks as each version spells them", () => {
    expect(skill).toContain(`"plugin_enabled": { "${HOST_BLOCKS[1].context}": false }`)
    expect(skill).toContain(`"-${HOST_BLOCKS[2].context}"`)
    expect(skill).toContain("never suggest turning it off")
    for (const id of [...Object.values(HOST_BLOCKS[1]), ...Object.values(HOST_BLOCKS[2])])
      expect(skill).toContain(`\`${id}\``)
  })

  test("the second phase: offered after the close, through its tool, with its reference", () => {
    expect(skill.indexOf("tune it to how you work")).toBeGreaterThan(skill.indexOf("## 8. Close"))
    expect(skill).toContain("`tune: true`")
    expect(skill).toContain(`\`${CONVENTIONS_TOOL}\``)
    expect(skill).toContain("(references/conventions.md)")
  })

  /** The JSON blocks under "Offer a starting point", as the skill writes them. */
  const presets = (() => {
    const section = skill.slice(skill.indexOf("## 3."), skill.indexOf("## 4."))
    /** Each starting point is a paragraph opening with its name in bold, then its JSON. */
    return section
      .split(/^(?=\*\*[^*]+\*\* — )/m)
      .slice(1)
      .map((part) => ({
        name: /^\*\*([^*]+)\*\*/.exec(part)?.[1] as string,
        json: JSON.parse(/```json\n([\s\S]*?)```/.exec(part)?.[1] ?? "null") as Record<string, unknown>,
      }))
  })()

  test("offers the starting points it describes", () => {
    expect(presets.map((preset) => preset.name)).toEqual([
      "Everything visible",
      "Quiet",
      "Minimal",
      "Classic",
    ])
  })

  test("every starting point is a file Cockpit reads without a single notice", () => {
    for (const preset of presets) {
      const report = settingsReport({
        opencode: 2,
        directory: "/work/app",
        env: {},
        home: "/home/me",
        read: (path) => {
          if (path.endsWith("/opencode/opencode.json"))
            return JSON.stringify({ plugins: ["opencode-cockpit"] })
          if (path.endsWith("/opencode-cockpit/config.json")) return JSON.stringify(preset.json)
          return undefined
        },
      })
      expect({ preset: preset.name, notices: report.notices }).toEqual({ preset: preset.name, notices: [] })
    }
  })

  test("the starting points do what they say", () => {
    const blocks = (json: Record<string, unknown>) => {
      const report = settingsReport({
        opencode: 2,
        directory: "/work/app",
        env: {},
        home: "/home/me",
        read: (path) => {
          if (path.endsWith("/opencode/opencode.json"))
            return JSON.stringify({ plugins: ["opencode-cockpit"] })
          if (path.endsWith("/opencode-cockpit/config.json")) return JSON.stringify(json)
          return undefined
        },
      })
      const sidebar = (bay: string) =>
        report.bays.find((state) => state.bay === bay)?.keys.find((key) => key.info.key === "sidebar")?.value
      return { subagents: sidebar("subagents"), shell: sidebar("shell"), status: sidebar("status") }
    }
    const [, , minimal, classic] = presets
    expect(blocks(minimal?.json ?? {})).toEqual({ subagents: false, shell: false, status: true })
    expect(blocks(classic?.json ?? {}).status).toBe(false)
  })
})
