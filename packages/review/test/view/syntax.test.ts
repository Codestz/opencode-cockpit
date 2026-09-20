import { describe, expect, test } from "bun:test"
import { languageOf, tokenize } from "../../src/core/view/syntax.ts"

const tones = (text: string, state?: { inBlockComment: boolean }) =>
  tokenize(text, "ts", state).runs.map((run) => [run.text, run.tone])

describe("languageOf", () => {
  test("reads the extension, and is happy not to know", () => {
    expect(languageOf("src/core/view/syntax.ts")).toBe("ts")
    expect(languageOf("a/b/tsconfig.json")).toBe("json")
    expect(languageOf("README.md")).toBe("markdown")
    expect(languageOf("scripts/release.sh")).toBe("shell")
    expect(languageOf("LICENSE")).toBe("plain")
  })
})

describe("tokenize", () => {
  test("tells keywords, names and punctuation apart", () => {
    expect(tones("const open = false")).toEqual([
      ["const", "keyword"],
      [" ", "text"],
      ["open", "variable"],
      [" ", "text"],
      ["=", "operator"],
      [" ", "text"],
      ["false", "number"],
    ])
  })

  test("a name followed by a bracket is a call; a capital is a type", () => {
    const runs = tokenize("new Store(config)", "ts").runs
    expect(runs.find((run) => run.text === "Store")?.tone).toBe("function")
    expect(runs.find((run) => run.text === "new")?.tone).toBe("keyword")
  })

  test("strings keep their quotes and survive escapes", () => {
    expect(tones('"a \\" b"')).toEqual([['"a \\" b"', "string"]])
  })

  test("a line comment swallows the rest of the line", () => {
    expect(tones("let x = 1 // and the rest")).toContainEqual(["// and the rest", "comment"])
  })

  test("a block comment carries across lines", () => {
    const first = tokenize("/* opened", "ts")
    expect(first.state.inBlockComment).toBe(true)
    const second = tokenize(" still inside", "ts", first.state)
    expect(second.runs).toEqual([{ text: " still inside", tone: "comment" }])
    const third = tokenize(" closed */ after", "ts", second.state)
    expect(third.state.inBlockComment).toBe(false)
    expect(third.runs[0]).toEqual({ text: " closed */", tone: "comment" })
  })

  test("plain text is left alone, whatever it contains", () => {
    expect(tokenize("const not really code", "plain").runs).toEqual([
      { text: "const not really code", tone: "text" },
    ])
  })

  test("every run together is the original line, always", () => {
    const line = 'export const x = { a: "b", n: 42 } // note'
    expect(
      tokenize(line, "ts")
        .runs.map((run) => run.text)
        .join(""),
    ).toBe(line)
  })
})
