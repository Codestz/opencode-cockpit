import { describe, expect, test } from "bun:test"
import { canonical, evaluate, gate, match, rulesFrom } from "../src/core/rules.ts"

describe("OpenCode's wildcard", () => {
  test("* is any run, ? one character", () => {
    expect(match("git status", "git *")).toBe(true)
    expect(match("git", "git *")).toBe(true) // the trailing " *" also matches nothing
    expect(match("gitk", "git *")).toBe(false)
    expect(match("ls -la", "ls ?la")).toBe(true)
    expect(match("anything at all", "*")).toBe(true)
  })

  test("regex characters are literal", () => {
    expect(match("a.b", "a.b")).toBe(true)
    expect(match("axb", "a.b")).toBe(false)
    expect(match("echo (x)", "echo (x)")).toBe(true)
  })
})

describe("rules from config", () => {
  test("v1: a word for everything, a word per permission, patterns per permission", () => {
    expect(rulesFrom({ permission: "ask" })).toEqual([{ permission: "*", pattern: "*", action: "ask" }])
    expect(rulesFrom({ permission: { bash: "ask", edit: "allow" } })).toEqual([
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "allow" },
    ])
    expect(
      rulesFrom({ permission: { bash: { "*": "ask", "git status": "allow", "git push *": "ask" } } }),
    ).toEqual([
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "git status", action: "allow" },
      { permission: "bash", pattern: "git push *", action: "ask" },
    ])
  })

  test("an agent's rules are laid over the global ones", () => {
    const config = {
      permission: { bash: "ask" },
      agent: { build: { permission: { bash: { "bun test": "allow" } } } },
    }
    expect(rulesFrom(config, "build").at(-1)).toEqual({
      permission: "bash",
      pattern: "bun test",
      action: "allow",
    })
    expect(rulesFrom(config, "plan")).toHaveLength(1)
  })

  test("v2: documents in priority order, `permissions` lists and its own names", () => {
    const documents = [
      { type: "directory", path: "/x" },
      {
        type: "document",
        path: "/g/opencode.json",
        info: { permissions: [{ action: "shell", resource: "*", effect: "ask" }] },
      },
      {
        type: "document",
        path: "/p/opencode.json",
        info: { permissions: [{ action: "shell", resource: "git push *", effect: "ask" }] },
      },
    ]
    expect(rulesFrom(documents)).toEqual([
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "git push *", action: "ask" },
    ])
  })

  test("names are one name whichever OpenCode asked", () => {
    expect(canonical("shell")).toBe("bash")
    expect(canonical("subagent")).toBe("task")
    expect(canonical("write")).toBe("edit")
    expect(canonical("webfetch")).toBe("webfetch")
  })

  test("garbage is ignored, not fatal", () => {
    expect(rulesFrom(undefined)).toEqual([])
    expect(rulesFrom({ permission: { bash: { x: "maybe" } } })).toEqual([])
    expect(rulesFrom({ permissions: [{ action: 1 }] })).toEqual([])
  })
})

describe("the two kinds of ask", () => {
  const rules = rulesFrom({
    permission: { bash: { "*": "ask", "git status": "allow", "git push *": "ask" } },
  })

  test("last match wins", () => {
    expect(evaluate(rules, "bash", "git status")?.action).toBe("allow")
    expect(evaluate(rules, "bash", "git push origin main")?.pattern).toBe("git push *")
    expect(evaluate(rules, "shell", "git status")?.action).toBe("allow")
  })

  test("a catch-all ask is open, a specific ask holds, an allow allows", () => {
    expect(gate(rules, "bash", "bun test").kind).toBe("open")
    expect(gate(rules, "bash", "git push").kind).toBe("held")
    expect(gate(rules, "bash", "git status").kind).toBe("allowed")
  })

  test("no rule at all is OpenCode's default ask: open", () => {
    expect(gate([], "bash", "ls").kind).toBe("open")
    expect(gate(rulesFrom({ permission: "ask" }), "edit", "src/a.ts").kind).toBe("open")
  })

  test("a deny holds", () => {
    expect(gate(rulesFrom({ permission: { bash: { "rm *": "deny" } } }), "bash", "rm x").kind).toBe("held")
  })
})
