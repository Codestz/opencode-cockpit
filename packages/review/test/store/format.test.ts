import { describe, expect, test } from "bun:test"
import type { Thread } from "../../src/core/model/thread.ts"
import { decode, encode } from "../../src/core/store/format.ts"

const thread: Thread = {
  id: "rv_1",
  file: "a.ts",
  line: 2,
  through: 4,
  quoted: ["one", "two"],
  entries: [
    { author: "you", body: "why?", at: 1 },
    { author: "agent", body: "because", at: 2 },
  ],
  status: "answered",
}

describe("round trip", () => {
  test("what goes in comes out", () => {
    expect(decode(encode(thread))).toEqual(thread)
  })

  test("a thread about the whole file keeps having no line", () => {
    const whole: Thread = { ...thread, line: undefined, through: undefined }
    expect(decode(encode(whole))?.line).toBeUndefined()
  })
})

describe("reading anything at all", () => {
  /**
   * These files outlive the version that wrote them. A shape nobody recognises has to cost one
   * thread, never the review — so every one of these is `undefined`, not a throw.
   */
  test("nonsense is not a thread", () => {
    expect(decode("")).toBeUndefined()
    expect(decode("{")).toBeUndefined()
    expect(decode("null")).toBeUndefined()
    expect(decode("[]")).toBeUndefined()
    expect(decode('"a string"')).toBeUndefined()
  })

  test("a thread without an id or a file is not a thread", () => {
    expect(decode(JSON.stringify({ entries: thread.entries }))).toBeUndefined()
    expect(decode(JSON.stringify({ id: "x", entries: thread.entries }))).toBeUndefined()
  })

  test("a thread with nothing said in it is a file that lost its contents", () => {
    expect(decode(JSON.stringify({ id: "x", file: "a.ts", entries: [] }))).toBeUndefined()
  })

  test("entries that are not entries are dropped, and the rest survives", () => {
    const mixed = JSON.stringify({
      id: "x",
      file: "a.ts",
      entries: [{ author: "you", body: "kept", at: 1 }, { author: "nobody", body: "dropped", at: 2 }, 42],
    })
    expect(decode(mixed)?.entries).toEqual([{ author: "you", body: "kept", at: 1 }])
  })

  test("a status nobody recognises reads as open, because open is the safe answer", () => {
    const odd = JSON.stringify({ ...thread, status: "half-done" })
    expect(decode(odd)?.status).toBe("open")
  })

  test("a quote that is not lines of text is ignored rather than trusted", () => {
    expect(decode(JSON.stringify({ ...thread, quoted: [1, 2] }))?.quoted).toBeUndefined()
  })
})
