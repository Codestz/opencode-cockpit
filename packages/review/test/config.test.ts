import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadReview } from "../src/core/config.ts"

/**
 * Review reads the files now, through the loader every bay shares: the `review` section, then the
 * plugin entry. Before 0.9 its settings lived only on the entry in `tui.json`.
 */

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync("/tmp/ck-review-conf-")
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function files(global: string | object | undefined, project?: string | object) {
  const home = temp()
  const directory = temp()
  const text = (value: string | object) => (typeof value === "string" ? value : JSON.stringify(value))
  if (global !== undefined) {
    mkdirSync(join(home, "opencode-cockpit"), { recursive: true })
    writeFileSync(join(home, "opencode-cockpit", "config.json"), text(global))
  }
  if (project !== undefined) writeFileSync(join(directory, ".cockpit.json"), text(project))
  return { directory, env: { XDG_CONFIG_HOME: home } }
}

describe("settings", () => {
  test("defaults: the right pane, uncommitted work", () => {
    const { directory, env } = files(undefined)
    const { config, notices } = loadReview(directory, undefined, env)
    expect(config).toMatchObject({ enabled: true, variant: "right", source: "worktree", keybinds: {} })
    expect(notices).toEqual([])
  })

  test("the `review` section of either file, and the entry's options over both", () => {
    const { directory, env } = files(
      `{ "review": { "variant": "full", "source": "branch", } // comments are fine
      }`,
      { review: { keybinds: { "cockpit.review.open": "<leader>c" } } },
    )
    const fromFiles = loadReview(directory, undefined, env).config
    expect(fromFiles).toMatchObject({ variant: "full", source: "branch" })
    expect(fromFiles.keybinds).toEqual({ "cockpit.review.open": "<leader>c" })
    /** A standalone entry carries its own keys; the bundle hands over a `review` section. */
    for (const options of [{ variant: "right" }, { review: { variant: "right" } }])
      expect(loadReview(directory, options, env).config.variant).toBe("right")
  })

  test("a value Review does not know is the default and a notice naming the ones it does", () => {
    const { directory, env } = files({ review: { variant: "left" } })
    const { config, notices } = loadReview(directory, { source: "session" }, env)
    expect(config.variant).toBe("right")
    expect(config.source).toBe("worktree")
    const variant = notices.find((notice) => notice.old === "review.variant")
    expect(variant?.text).toContain("right, full")
    expect(variant?.file).toEndWith("config.json")
    expect(notices.find((notice) => notice.old === "review.source")?.file).toBe("plugin options")
  })

  test("`features.review: false` in a file turns it off", () => {
    const { directory, env } = files({ features: { review: false } })
    expect(loadReview(directory, undefined, env).config.enabled).toBe(false)
  })
})
