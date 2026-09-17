import { describe, expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import { composeHooks } from "../src/compose.ts"
import { featureOptions, isEnabled } from "../src/features.ts"

describe("composeHooks", () => {
  test("unions tools and runs shared hooks in feature order", async () => {
    const calls: string[] = []
    const a: Hooks = {
      tool: { a_tool: {} as never },
      event: async () => void calls.push("a:event"),
      dispose: async () => void calls.push("a:dispose"),
    }
    const b: Hooks = {
      tool: { b_tool: {} as never },
      event: async () => void calls.push("b:event"),
    }
    const hooks = composeHooks([a, b])
    expect(Object.keys(hooks.tool ?? {})).toEqual(["a_tool", "b_tool"])
    await hooks.event?.({ event: {} as never })
    await hooks.dispose?.()
    expect(calls).toEqual(["a:event", "b:event", "a:dispose"])
  })

  test("a tool name registered twice is a bug and throws", () => {
    expect(() => composeHooks([{ tool: { same: {} as never } }, { tool: { same: {} as never } }])).toThrow(
      'tool "same" is registered by more than one cockpit feature',
    )
  })

  test("no features means no hooks", () => {
    expect(composeHooks([])).toEqual({})
    expect(composeHooks([{}])).toEqual({})
  })
})

describe("feature options", () => {
  test("features are on unless switched off", () => {
    expect(isEnabled(undefined, "shell")).toBe(true)
    expect(isEnabled({ features: {} }, "shell")).toBe(true)
    expect(isEnabled({ features: { shell: false } }, "shell")).toBe(false)
  })

  test("shell options come from their own key, with 0.1.x top-level options as fallback", () => {
    expect(featureOptions({ dockHeight: 10, shell: { dockHeight: 20, dockOpen: true } }, "shell")).toEqual({
      dockHeight: 20,
      dockOpen: true,
    })
    expect(featureOptions({ dockHeight: 10, features: { shell: true } }, "shell")).toEqual({ dockHeight: 10 })
  })
})
