import { describe, expect, test } from "bun:test"
import { pinnedVersion } from "../src/tui/lib/update.ts"

const NAME = "opencode-cockpit"

/**
 * The update clears a cache entry so the next start reinstalls. Against a pinned spec that
 * reinstalls the same version, so knowing a pin is there is the difference between updating and
 * saying you did.
 */
describe("finding a pin", () => {
  test("a bare name pins nothing", () => {
    expect(pinnedVersion([NAME], NAME)).toBeUndefined()
  })

  test("a version is a pin", () => {
    expect(pinnedVersion([`${NAME}@0.4.0`], NAME)).toBe("0.4.0")
  })

  test("a tag is not a pin — it moves on its own", () => {
    expect(pinnedVersion([`${NAME}@latest`], NAME)).toBeUndefined()
    expect(pinnedVersion([`${NAME}@next`], NAME)).toBeUndefined()
  })

  test("a path install pins nothing, whatever it looks like", () => {
    expect(pinnedVersion(["/Users/me/code/opencode-cockpit/packages/opencode"], NAME)).toBeUndefined()
    expect(pinnedVersion(["./local/plugin@0.1.0"], NAME)).toBeUndefined()
    expect(pinnedVersion(["file:../cockpit@0.1.0"], NAME)).toBeUndefined()
  })

  test("a scoped name keeps its own @", () => {
    expect(pinnedVersion(["@opencode-cockpit/shell@1.2.3"], "@opencode-cockpit/shell")).toBe("1.2.3")
    expect(pinnedVersion(["@opencode-cockpit/shell"], "@opencode-cockpit/shell")).toBeUndefined()
  })

  test("an entry paired with options is read the same way", () => {
    expect(pinnedVersion([[`${NAME}@2.0.0`, { ui: {} }]], NAME)).toBe("2.0.0")
  })

  test("another plugin's pin is not ours", () => {
    expect(pinnedVersion(["some-other-plugin@9.9.9", NAME], NAME)).toBeUndefined()
  })

  test("a prerelease still pins", () => {
    expect(pinnedVersion([`${NAME}@1.0.0-rc.1`], NAME)).toBe("1.0.0-rc.1")
  })
})
