import { describe, expect, test } from "bun:test"
import { findsOf, ran } from "../src/core/scan.ts"
import { linkArgs } from "../src/core/tools.ts"
import { openUrl } from "../src/tui/open.ts"

/** Shapes as measured on 1.18.32 and 2.0.18 (docs/opencode/trail-server.md). */

describe("which calls count: what the agent ran", () => {
  test("shells and MCP tools; never reading, fetching, a subagent's answer or Code Mode's outer call", () => {
    for (const tool of ["bash", "shell", "shell_read", "github_create_pull_request", "spike_open_pr"])
      expect(ran(tool)).toBe(true)
    for (const tool of ["read", "webfetch", "websearch", "grep", "task", "subagent", "execute", "trail_add"])
      expect(ran(tool)).toBe(false)
  })

  test("only PR and issue links, by their own address", () => {
    const found = findsOf(
      {
        tool: "bash",
        output:
          "https://github.com/acme/web/pull/40/files\nhttps://acme.dev/docs\nhttps://acme.atlassian.net/browse/COM-9.",
      },
      5,
    )
    expect(found.map((f) => f.url)).toEqual([
      "https://github.com/acme/web/pull/40",
      "https://acme.atlassian.net/browse/COM-9",
    ])
    expect(found[0]).toEqual({ url: "https://github.com/acme/web/pull/40", ref: "acme/web#40", at: 5 })
  })
})

describe("opening a link (which program: client's openerFor)", () => {
  test("only http(s) is handed to an opener; anything else is refused, and says so", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)"]) {
      const said: string[] = []
      openUrl(url, (why) => said.push(why))
      expect(said).toEqual(["only http(s) links are opened"])
    }
  })
})

describe("/link: the link, then a note", () => {
  test("the note is the title; with none, a PR's own name, else the link", () => {
    expect(linkArgs("https://github.com/a/b/pull/4  the checkout fix")).toEqual({
      title: "the checkout fix",
      url: "https://github.com/a/b/pull/4",
    })
    expect(linkArgs("https://github.com/a/b/pull/4")).toEqual({
      title: "a/b#4",
      url: "https://github.com/a/b/pull/4",
    })
    expect(linkArgs("https://acme.dev/runbook/")).toEqual({
      title: "acme.dev/runbook",
      url: "https://acme.dev/runbook/",
    })
    expect(linkArgs("   ")).toBeUndefined()
  })
})
