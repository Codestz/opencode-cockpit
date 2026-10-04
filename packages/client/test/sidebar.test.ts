import { describe, expect, test } from "bun:test"
import type { Host } from "../src/host.ts"
import { orderedSidebar } from "../src/sidebar.ts"

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
