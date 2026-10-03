import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readSkill } from "@opencode-cockpit/client/server"
import { BUILTINS } from "../src/core/builtins/index.ts"
import { configNotices, loadStatus, PRESETS } from "../src/core/config.ts"
import { SEGMENT_ABOUT, statusReference } from "../src/core/reference.ts"
import { OLD_PROMPT, SETUP_PROMPT, SETUP_SKILL, SETUP_SKILL_DIR } from "../src/core/setup.ts"
import { createStatusServer } from "../src/server.ts"

/**
 * The `status-setup` skill is text shipped beside code that changes. These keep it honest: its
 * reference is what the code writes, every built-in is described, every starting point it offers is a
 * `status` section Status reads without a notice, and the old command says its new name.
 */

const skill = readFileSync(join(SETUP_SKILL_DIR, "SKILL.md"), "utf8")
const read = (name: string) => readFileSync(join(SETUP_SKILL_DIR, "references", name), "utf8")

describe("the reference", () => {
  test("is what the code writes — run `bun packages/status/src/cli/reference.ts` when it is not", () => {
    expect(read("settings.md")).toBe(statusReference())
  })

  test("every built-in segment is described, and nothing that is not one", () => {
    expect(Object.keys(SEGMENT_ABOUT).sort()).toEqual(BUILTINS.map((segment) => segment.name).sort())
  })

  test("every preset is in it", () => {
    for (const name of Object.keys(PRESETS)) expect(read("settings.md")).toContain(`| \`${name}\` |`)
  })

  test("the design rules a copied statusline-design still carries are the same rules", () => {
    const old = readFileSync(join(SETUP_SKILL_DIR, "..", "statusline-design", "SKILL.md"), "utf8")
    expect(old.endsWith(read("design.md"))).toBe(true)
  })
})

describe("the skill", () => {
  test("is named for the command, and says when to use it", () => {
    const parsed = readSkill({ dir: SETUP_SKILL_DIR })
    expect(parsed?.name).toBe(SETUP_SKILL)
    const description = parsed?.description ?? ""
    expect(description.length).toBeLessThan(1024)
    for (const trigger of ["/status-setup", "/statusline", "Claude Code statusline", "at the bottom"])
      expect(description).toContain(trigger)
    expect(skill).toContain("`cockpit_settings`")
    expect(skill).toContain("(references/settings.md)")
    expect(skill).toContain("(references/design.md)")
  })

  /** Each starting point: a paragraph opening with its name in bold, then its JSON. */
  const presets = skill
    .slice(skill.indexOf("## 3."), skill.indexOf("## 4."))
    .split(/^(?=\*\*[^*]+\*\* — )/m)
    .slice(1)
    .map((part) => ({
      name: /^\*\*([^*]+)\*\*/.exec(part)?.[1] as string,
      json: JSON.parse(/```json\n([\s\S]*?)```/.exec(part)?.[1] ?? "null") as Record<string, unknown>,
    }))

  test("every starting point is a status section Status reads without a notice", () => {
    expect(presets.map((preset) => preset.name)).toEqual([
      "The table",
      "One line",
      "Minimal line",
      "Detailed line",
      "My Claude Code statusline",
    ])
    for (const preset of presets) {
      const loaded = loadStatus({
        where: {
          env: {},
          home: "/home/me",
          read: (path) => (path.endsWith("config.json") ? JSON.stringify(preset.json) : undefined),
        },
      })
      expect({ preset: preset.name, notices: [...loaded.notices, ...configNotices(loaded.config)] }).toEqual({
        preset: preset.name,
        notices: [],
      })
    }
  })
})

describe("the agent side", () => {
  const host = () =>
    ({ version: 1, directory: "/work/app", scope: {}, log: { info() {}, warn() {} } }) as never

  test("the skill and both commands, the old one saying the new name first", async () => {
    const parts = await createStatusServer()(host(), {})
    expect(parts.skills).toEqual([{ dir: SETUP_SKILL_DIR }])
    expect(parts.commands?.map((command) => [command.name, command.prompt])).toEqual([
      ["status-setup", SETUP_PROMPT],
      ["statusline", OLD_PROMPT],
    ])
    expect(OLD_PROMPT.startsWith("/statusline is now /status-setup.")).toBe(true)
  })

  test("the bundle and this package side by side register them once", async () => {
    const shared = { version: 1, directory: "/work/app", scope: {}, log: { info() {}, warn() {} } } as never
    expect((await createStatusServer({ source: "opencode-cockpit" })(shared, {})).skills).toHaveLength(1)
    expect(await createStatusServer()(shared, {})).toEqual({})
  })
})
