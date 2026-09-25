import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Host } from "../src/host.ts"
import { orderedSidebar, sidebarOrder } from "../src/sidebar.ts"

/** One list orders every bay's sidebar block; a bay's own number still wins; a project beats global. */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function setup(global?: unknown, project?: unknown) {
  const root = mkdtempSync("/tmp/ck-sidebar-")
  dirs.push(root)
  const config = join(root, "config")
  const directory = join(root, "project")
  mkdirSync(join(config, "opencode-cockpit"), { recursive: true })
  mkdirSync(directory, { recursive: true })
  if (global) writeFileSync(join(config, "opencode-cockpit", "config.json"), JSON.stringify(global))
  if (project) writeFileSync(join(directory, ".cockpit.json"), JSON.stringify(project))
  return { directory, env: { XDG_CONFIG_HOME: config } }
}

describe("the sidebar order", () => {
  test("the list puts the statusline first, ahead of every default", () => {
    const where = setup({ sidebar: ["status", "subagents", "shell"] })
    const status = sidebarOrder("status", 200, undefined, where)
    const subagents = sidebarOrder("subagents", 160, undefined, where)
    const shell = sidebarOrder("shell", 150, undefined, where)
    expect(status).toBeLessThan(subagents)
    expect(subagents).toBeLessThan(shell)
    expect(shell).toBeLessThan(150)
  })

  test("a bay's own number beats the list; a bay the list leaves out keeps its default", () => {
    const where = setup({ sidebar: ["status"] })
    expect(sidebarOrder("status", 200, 999, where)).toBe(999)
    expect(sidebarOrder("shell", 150, undefined, where)).toBe(150)
  })

  test("a project's list beats the global one; no list, no change", () => {
    const where = setup({ sidebar: ["shell", "status"] }, { sidebar: ["status", "shell"] })
    expect(sidebarOrder("status", 200, undefined, where)).toBeLessThan(
      sidebarOrder("shell", 150, undefined, where),
    )
    expect(sidebarOrder("status", 200, undefined, setup())).toBe(200)
  })
})

describe("orderedSidebar", () => {
  test("sidebar blocks register in their order, everything else at once", () => {
    const seen: string[] = []
    const host = {
      slots: {
        register: (input: { order?: number; slots: Record<string, unknown> }) =>
          seen.push(`${Object.keys(input.slots).join("+")}@${input.order}`),
      },
    } as unknown as Host
    const { host: held, flush } = orderedSidebar(host)
    const block = () => null as never
    held.slots.register({ order: 170, slots: { sidebar_content: block, app_bottom: block } })
    held.slots.register({ order: 140, slots: { sidebar_content: block } })
    held.slots.register({ order: 150, slots: { sidebar_content: block } })
    expect(seen).toEqual(["app_bottom@170"])
    flush()
    expect(seen).toEqual([
      "app_bottom@170",
      "sidebar_content@140",
      "sidebar_content@150",
      "sidebar_content@170",
    ])
  })
})
