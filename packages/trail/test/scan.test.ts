import { describe, expect, test } from "bun:test"
import { openerFor } from "../src/core/open.ts"
import { findsInV1, findsInV2, findsOf, ran } from "../src/core/scan.ts"
import { linkArgs } from "../src/core/tools.ts"

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
    expect(found[0]).toMatchObject({ ref: "acme/web#40", label: "PR #40", system: "GitHub", at: 5 })
  })
})

describe("stored history", () => {
  test("OpenCode 1: tool parts only — the person's own prompt is not something the agent ran", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "run echo https://github.com/a/b/pull/1" }] },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", output: "https://github.com/a/b/pull/1\n", time: { end: 9 } },
          },
          {
            type: "tool",
            tool: "spike_open_pr",
            state: { status: "completed", output: "https://github.com/a/b/pull/2" },
          },
          {
            type: "tool",
            tool: "read",
            state: { status: "completed", output: "https://github.com/a/b/pull/3" },
          },
          { type: "tool", tool: "bash", state: { status: "error", output: "https://github.com/a/b/pull/4" } },
        ],
      },
    ]
    const found = findsInV1(messages)
    expect(found.map((f) => f.url)).toEqual([
      "https://github.com/a/b/pull/1",
      "https://github.com/a/b/pull/2",
    ])
    expect(found[0]?.at).toBe(9)
  })

  test("OpenCode 2: shell parts, and an execute that called an MCP tool — not one that searched", () => {
    const messages = [
      {
        type: "assistant",
        time: { created: 1 },
        content: [
          {
            type: "tool",
            name: "shell",
            state: {
              status: "completed",
              content: [{ type: "text", text: "https://github.com/a/b/pull/33\n" }],
            },
            time: { completed: 7 },
          },
          {
            type: "tool",
            name: "execute",
            state: {
              status: "completed",
              content: [{ type: "text", text: "Created pull request: https://github.com/a/mcp/pull/77" }],
              metadata: { toolCalls: [{ tool: "spike.open_pr", status: "completed" }] },
            },
          },
          {
            type: "tool",
            name: "execute",
            state: {
              status: "completed",
              content: [{ type: "text", text: "catalog https://github.com/a/b/pull/5" }],
              metadata: { toolCalls: [{ tool: "search" }, { tool: "spike.open_pr" }] },
            },
          },
          {
            type: "tool",
            name: "execute",
            state: {
              status: "completed",
              content: [{ type: "text", text: "recorded https://github.com/a/b/pull/6" }],
              metadata: { toolCalls: [{ tool: "trail_add" }] },
            },
          },
        ],
      },
    ]
    expect(findsInV2(messages).map((f) => f.url)).toEqual([
      "https://github.com/a/b/pull/33",
      "https://github.com/a/mcp/pull/77",
    ])
  })
})

describe("opening a link", () => {
  const where = (platform: string, have: string[] = []) => ({
    platform,
    exists: (path: string) => have.includes(path),
    which: (name: string) => (have.includes(name) ? `/somewhere/${name}` : undefined),
  })

  test("macOS: /usr/bin/open first, then PATH", () => {
    const url = "https://github.com/a/b/pull/1"
    expect(openerFor(url, where("darwin", ["/usr/bin/open", "open"]))).toEqual({
      command: "/usr/bin/open",
      args: [url],
    })
    expect(openerFor(url, where("darwin", ["open"]))?.command).toBe("/somewhere/open")
    expect(openerFor(url, where("darwin"))).toBeUndefined()
  })

  test("Linux: xdg-open; Windows: start, with & kept from cmd", () => {
    expect(openerFor("https://a.dev/x", where("linux", ["xdg-open"]))?.command).toBe("/somewhere/xdg-open")
    expect(openerFor("https://a.dev/x", where("linux"))).toBeUndefined()
    expect(openerFor("https://a.dev/?a=1&b=2", where("win32"))?.args).toEqual([
      "/c",
      "start",
      '""',
      "https://a.dev/?a=1^&b=2",
    ])
  })

  test("only http(s); an override wins", () => {
    expect(openerFor("file:///etc/passwd", where("darwin", ["/usr/bin/open"]))).toBeUndefined()
    expect(openerFor("javascript:alert(1)", where("darwin", ["/usr/bin/open"]))).toBeUndefined()
    expect(
      openerFor("https://a.dev", { ...where("darwin", ["/usr/bin/open"]), override: "/tmp/stub" }),
    ).toEqual({
      command: "/tmp/stub",
      args: ["https://a.dev"],
    })
  })
})

describe("/link <url> [note]", () => {
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
