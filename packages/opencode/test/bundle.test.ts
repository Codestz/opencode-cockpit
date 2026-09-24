import { describe, expect, test } from "bun:test"
import { featureOptions, isEnabled } from "../src/features.ts"

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
