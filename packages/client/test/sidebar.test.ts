import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Host } from "../src/host.ts"
import { orderedSidebar, sidebarList, sidebarOrder } from "../src/sidebar.ts"

/** One list orders every bay's sidebar block, and nothing else does; a project's list beats global. */

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

describe("the sidebar order, for bays that have not moved to baySettings", () => {
  test("with no list, the default order: status, subagents, shell, trail, trust", () => {
    const where = setup()
    const order = ["status", "subagents", "shell", "trail", "trust"].map((bay) =>
      sidebarOrder(bay, 999, undefined, where),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((at) => at > 100 && at < 200)).toBe(true)
  })

  test("the list decides, and a bay's own number no longer does", () => {
    const where = setup({ sidebar: ["trust", "status"] })
    expect(sidebarOrder("trust", 160, undefined, where)).toBeLessThan(sidebarOrder("status", 140, 1, where))
    expect(sidebarList(where)).toEqual(["trust", "status"])
  })

  test("a project's list beats the global one; a name that is not a sidebar bay keeps its fallback", () => {
    const where = setup({ sidebar: ["shell", "status"] }, { sidebar: ["status", "shell"] })
    expect(sidebarOrder("status", 200, undefined, where)).toBeLessThan(
      sidebarOrder("shell", 150, undefined, where),
    )
    expect(sidebarOrder("review", 777, undefined, where)).toBe(777)
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
