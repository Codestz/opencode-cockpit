import { describe, expect, test } from "bun:test"
import { parseJsonc } from "../src/core/jsonc.ts"
import { isNewer, parseSpec } from "../src/core/spec.ts"

describe("parseSpec", () => {
  test("an exact version is the only pin", () => {
    expect(parseSpec("opencode-cockpit@0.4.3")).toEqual({
      kind: "npm",
      raw: "opencode-cockpit@0.4.3",
      name: "opencode-cockpit",
      pin: { type: "exact", version: "0.4.3" },
    })
    expect(parseSpec("x@1.0.0-beta.2").kind === "npm" && parseSpec("x@1.0.0-beta.2")).toMatchObject({
      pin: { type: "exact", version: "1.0.0-beta.2" },
    })
  })

  test("a tag or a range is frozen the same way a bare name is", () => {
    expect(parseSpec("opencode-cockpit@latest")).toMatchObject({ pin: { type: "tag", tag: "latest" } })
    expect(parseSpec("opencode-cockpit@^0.4.0")).toMatchObject({ pin: { type: "tag", tag: "^0.4.0" } })
    expect(parseSpec("opencode-cockpit")).toMatchObject({ name: "opencode-cockpit", pin: { type: "none" } })
  })

  test("a scoped name keeps its leading @", () => {
    expect(parseSpec("@opencode-cockpit/shell")).toMatchObject({
      name: "@opencode-cockpit/shell",
      pin: { type: "none" },
    })
    expect(parseSpec("@opencode-cockpit/shell@0.4.3")).toMatchObject({
      name: "@opencode-cockpit/shell",
      pin: { type: "exact", version: "0.4.3" },
    })
  })

  test("paths and URLs are local, not the registry's", () => {
    for (const raw of [
      "./plugins/x",
      "/abs/plugin",
      "~/p",
      "file:../p",
      "github:me/plugin",
      "git+https://x/y.git",
    ]) {
      expect(parseSpec(raw).kind).toBe("local")
    }
  })
})

describe("isNewer", () => {
  test("only a higher release counts", () => {
    expect(isNewer("0.5.0", "0.4.3")).toBe(true)
    expect(isNewer("0.4.3", "0.4.3")).toBe(false)
    expect(isNewer("0.4.2", "0.4.3")).toBe(false)
    expect(isNewer("0.4.3", "0.4.3-beta.1")).toBe(true)
    expect(isNewer("0.4.3-beta.1", "0.4.3")).toBe(false)
    expect(isNewer("latest", "0.4.3")).toBe(false)
  })
})

describe("parseJsonc", () => {
  test("drops comments and trailing commas, and leaves strings alone", () => {
    const text = `{
      // the plugins
      "$schema": "https://opencode.ai/config.json", /* a URL is not a comment */
      "plugin": ["a@1.0.0", "b,}",],
    }`
    expect(parseJsonc(text)).toEqual({
      ok: true,
      value: { $schema: "https://opencode.ai/config.json", plugin: ["a@1.0.0", "b,}"] },
    })
  })

  test("an escaped quote does not end a string", () => {
    expect(parseJsonc(`{"a": "say \\"hi\\" // not a comment"}`)).toEqual({
      ok: true,
      value: { a: 'say "hi" // not a comment' },
    })
  })

  test("broken JSON is a failure with a message, not an empty config", () => {
    const result = parseJsonc(`{"plugin": [}`)
    expect(result.ok).toBe(false)
  })
})
