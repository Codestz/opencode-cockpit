import { describe, expect, test } from "bun:test"
import { BAYS } from "../src/settings/index.ts"
import { bayOf, baysOfEntry, pluginEntries } from "../src/settings/plugin-entries.ts"

describe("Cockpit's plugin entries (one reader for /cockpit-setup and doctor)", () => {
  test("every spelling of an entry, v1's and v2's", () => {
    expect(
      pluginEntries({
        plugin: ["a@1", ["b", { x: 1 }], [2]],
        plugins: [{ package: "c", options: { y: 2 } }, { name: "d" }],
      }),
    ).toEqual([{ name: "a@1" }, { name: "b", options: { x: 1 } }, { name: "c", options: { y: 2 } }])
  })

  test("a file that is not an object lists nothing", () => {
    for (const value of [undefined, null, "x", [], 3]) expect(pluginEntries(value)).toEqual([])
  })

  test("a package name is a bay, the bundle, or not ours", () => {
    expect(bayOf("opencode-cockpit")).toBe("bundle")
    expect(bayOf("@opencode-cockpit/shell")).toBe("shell")
    expect(bayOf("@opencode-cockpit/client")).toBeUndefined()
    expect(bayOf("@opencode-cockpit/shell@0.9.0")).toBeUndefined()
    expect(bayOf(undefined)).toBeUndefined()
  })

  test("an entry as written brings its bays: versions and paths too", () => {
    expect(baysOfEntry("opencode-cockpit@0.9.0")).toEqual([...BAYS])
    expect(baysOfEntry("/home/me/src/opencode-cockpit/")).toEqual([...BAYS])
    expect(baysOfEntry("@opencode-cockpit/trail@latest")).toEqual(["trail"])
    expect(baysOfEntry("C:\\x\\node_modules\\@opencode-cockpit\\review")).toEqual(["review"])
    expect(baysOfEntry("@opencode-cockpit/client")).toEqual([])
    expect(baysOfEntry("opencode-foo")).toEqual([])
  })
})
