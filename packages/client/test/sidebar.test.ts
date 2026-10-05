import { describe, expect, test } from "bun:test"
import type { Host } from "../src/opencode/host/index.ts"
import { blockWidth, measureBlock, orderedSidebar } from "../src/opencode/sidebar.ts"

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

describe("a block's width", () => {
  test("the container's, not the rows': a block stretched by a long row still draws at the sidebar's", () => {
    expect(blockWidth({ width: 60, parent: { width: 36 } }, 200)).toBe(36)
    expect(blockWidth({ width: 30, parent: { width: 36 } }, 200)).toBe(30)
  })

  test("before the first layout, a quarter of the window, between 20 and the widest guess", () => {
    expect(blockWidth(undefined, 200)).toBe(40)
    expect(blockWidth(undefined, 200, 30)).toBe(30)
    expect(blockWidth({ width: 0, parent: { width: 0 } }, 60)).toBe(20)
    expect(measureBlock(undefined)).toEqual({ parent: 0, own: 0, measured: 0 })
  })
})
