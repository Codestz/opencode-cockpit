import { describe, expect, test } from "bun:test"
import { parseJsonc } from "../src/settings/jsonc.ts"

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
