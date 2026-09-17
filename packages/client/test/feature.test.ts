import { describe, expect, test } from "bun:test"
import { claimFeature } from "../src/index.ts"

describe("claimFeature", () => {
  test("first copy in a scope wins; later copies are inactive and name the owner", () => {
    const scope = {}
    const first = claimFeature(scope, "shell", "opencode-cockpit")
    const second = claimFeature(scope, "shell", "@opencode-cockpit/shell")
    expect(first.active).toBe(true)
    expect(second.active).toBe(false)
    expect(second.owner).toBe("opencode-cockpit")
  })

  test("scopes and features are independent", () => {
    const a = {}
    const b = {}
    expect(claimFeature(a, "shell", "x").active).toBe(true)
    expect(claimFeature(b, "shell", "x").active).toBe(true)
    expect(claimFeature(a, "agents", "x").active).toBe(true)
  })

  test("release lets a reloaded plugin claim again; inactive release changes nothing", () => {
    const scope = {}
    const owner = claimFeature(scope, "shell", "one")
    const loser = claimFeature(scope, "shell", "two")
    loser.release()
    expect(claimFeature(scope, "shell", "three").active).toBe(false)
    owner.release()
    owner.release()
    expect(claimFeature(scope, "shell", "reloaded").active).toBe(true)
  })

  test("the registry is shared across module copies via a global symbol", async () => {
    const scope = {}
    expect(claimFeature(scope, "shell", "copy-a").active).toBe(true)
    // A second installed copy of the client package would be a different module instance.
    const fresh = await import(`../src/feature.ts?copy=${Date.now()}`)
    expect(fresh.claimFeature(scope, "shell", "copy-b").active).toBe(false)
  })
})
