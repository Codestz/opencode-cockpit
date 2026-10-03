import { describe, expect, test } from "bun:test"
import { checkAdd, checkList, LIMITS, recordedEvent } from "../src/core/add.ts"
import { apply, emptyState } from "../src/core/store.ts"

const who = { session: "ses_1", rootSession: "ses_1", by: "agent" as const, at: 1000 }

const refused = (args: unknown) => {
  const checked = checkAdd(args)
  if (checked.ok) throw new Error("expected a refusal")
  return checked.error
}

describe("trail_add's arguments", () => {
  test("a title and a url is enough", () => {
    expect(checkAdd({ title: "Release notes", url: "https://acme.atlassian.net/wiki/x/1" })).toEqual({
      ok: true,
      fields: { title: "Release notes", url: "https://acme.atlassian.net/wiki/x/1" },
      stripped: [],
    })
  })

  test("a title and a ref is enough", () => {
    expect(checkAdd({ title: "Bump", ref: "a1b2c3d" }).ok).toBe(true)
  })

  test("no title: refused, saying what a title is and that nothing was recorded", () => {
    const error = refused({ url: "https://github.com/a/b/pull/1" })
    expect(error).toContain("needs a `title`")
    expect(error).toContain("Nothing was recorded")
    expect(error).toContain("Call it again")
    expect(refused({ title: "   ", url: "https://x.dev" })).toContain("needs a `title`")
  })

  test("neither url nor ref: refused, with what each is", () => {
    const error = refused({ title: "Something" })
    expect(error).toContain("`url`")
    expect(error).toContain("`ref`")
    expect(error).toContain("Nothing was recorded")
  })

  test("a url that is not a web link: refused, pointing at ref instead", () => {
    const error = refused({ title: "Notes", url: "file:///tmp/notes.md" })
    expect(error).toContain("http(s)")
    expect(error).toContain("pass `ref`")
    expect(refused({ title: "x", url: "javascript:alert(1)" })).toContain("http(s)")
  })

  test("not text, or not an object: refused, saying so", () => {
    expect(refused({ title: ["a", "b"], ref: "x" })).toContain("`title` must be text, got a list")
    expect(refused({ title: "a", ref: { id: 1 } })).toContain("`ref` must be text, got object")
    expect(refused("PR #33")).toContain("takes an object")
    expect(refused(null)).toContain("takes an object")
  })

  test("a link without its scheme is taken as https", () => {
    const checked = checkAdd({ title: "PR", url: "github.com/a/b/pull/4" })
    expect(checked.ok && checked.fields.url).toBe("https://github.com/a/b/pull/4")
  })

  test("a PR link names itself when no ref is given; a given ref wins", () => {
    const derived = checkAdd({ title: "PR", url: "https://github.com/a/b/pull/4" })
    expect(derived.ok && derived.fields.ref).toBe("a/b#4")
    const given = checkAdd({ title: "PR", url: "https://github.com/a/b/pull/4", ref: "WEB-4" })
    expect(given.ok && given.fields.ref).toBe("WEB-4")
  })

  test("secrets are stripped from the link, and named", () => {
    const checked = checkAdd({ title: "Report", url: "https://r.acme.dev/x?token=abc&tab=2" })
    expect(checked).toEqual({
      ok: true,
      fields: { title: "Report", url: "https://r.acme.dev/x?tab=2" },
      stripped: ["token"],
    })
  })

  test("free text is kept on one line, and cut when too long", () => {
    const checked = checkAdd({
      title: "Two\nlines",
      ref: 33,
      note: "n".repeat(LIMITS.note + 50),
      kind: "  ",
      for: null,
    })
    if (!checked.ok) throw new Error(checked.error)
    expect(checked.fields.title).toBe("Two lines")
    expect(checked.fields.ref).toBe("33")
    expect(checked.fields.note?.length).toBe(LIMITS.note)
    expect(checked.fields.note?.endsWith("…")).toBe(true)
    expect(checked.fields).not.toHaveProperty("kind")
    expect(checked.fields).not.toHaveProperty("for")
  })
})

describe("the event a call becomes", () => {
  test("unsaid, the action is created for something new and updated for something known", () => {
    const state = emptyState()
    const fields = { title: "PR", url: "https://github.com/a/b/pull/4" }
    const first = recordedEvent(fields, { ...who, id: "e1" }, state)
    expect(first.action).toBe("created")
    apply(state, first)
    expect(recordedEvent(fields, { ...who, id: "e2" }, state).action).toBe("updated")
    expect(recordedEvent({ ...fields, action: "merged" }, { ...who, id: "e3" }, state).action).toBe("merged")
  })

  test("carries who made it and in which conversation", () => {
    const event = recordedEvent(
      { title: "Doc", ref: "D-1" },
      {
        session: "ses_child",
        rootSession: "ses_root",
        sessionTitle: "Plan",
        by: "agent",
        subagent: "docs",
        at: 5,
      },
      emptyState(),
    )
    expect(event).toMatchObject({
      type: "recorded",
      session: "ses_child",
      rootSession: "ses_root",
      sessionTitle: "Plan",
      subagent: "docs",
      by: "agent",
      at: 5,
    })
    expect(event.id).toMatch(/^tr_/)
  })
})

describe("trail_list's arguments", () => {
  test("both optional, and forgiving", () => {
    expect(checkList(undefined)).toEqual({ all: false, query: "" })
    expect(checkList({ all: true, query: " COM-1736 " })).toEqual({ all: true, query: "COM-1736" })
    expect(checkList({ all: "true" }).all).toBe(true)
    expect(checkList({ all: "no", query: 4 })).toEqual({ all: false, query: "" })
  })
})
