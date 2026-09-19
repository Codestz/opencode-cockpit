import { describe, expect, test } from "bun:test"
import {
  type ClaudeCodeStatusInput,
  claudeCodeInput,
  cleanOutput,
  createRunner,
  execShell,
} from "../src/core/command.ts"
import type { StatusContext } from "../src/core/context.ts"

const ctx = (over: Partial<StatusContext> = {}): StatusContext => ({
  now: 60_000,
  directory: "/w/app/src",
  worktree: "/w/app",
  home: "/home/u",
  version: "0.2.2",
  lsp: [],
  mcp: [],
  commands: {},
  width: 120,
  ...over,
})

describe("reading a command's output", () => {
  test("takes the first line and trims it", () => {
    expect(cleanOutput("  hello  \nsecond\n")).toBe("hello")
    expect(cleanOutput("")).toBe("")
  })

  // Scripts written for Claude Code colour themselves with escapes; the line is painted from
  // theme tones instead, so the escapes must not reach the screen as text.
  test("strips the colour escapes a ported script will emit", () => {
    const esc = String.fromCharCode(27)
    expect(cleanOutput(`${esc}[32mmain${esc}[0m`)).toBe("main")
  })
})

describe("the Claude Code payload", () => {
  const input = (): ClaudeCodeStatusInput =>
    claudeCodeInput(
      ctx({
        session: {
          id: "ses_1",
          status: "idle",
          cost: 1.5,
          priced: true,
          messages: 4,
          startedAt: 30_000,
          model: { providerID: "anthropic", modelID: "claude-opus-5" },
          tokens: { input: 300_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          diff: { files: 2, additions: 40, deletions: 3 },
          todo: { total: 0, completed: 0 },
        },
      }),
    )

  test("carries the fields an existing statusline script reads", () => {
    const payload = input()
    expect(payload.hook_event_name).toBe("Status")
    expect(payload.session_id).toBe("ses_1")
    expect(payload.cwd).toBe("/w/app/src")
    expect(payload.workspace).toEqual({ current_dir: "/w/app/src", project_dir: "/w/app" })
    expect(payload.model.id).toBe("claude-opus-5")
    expect(payload.cost.total_cost_usd).toBe(1.5)
    expect(payload.cost.total_lines_added).toBe(40)
    expect(payload.cost.total_lines_removed).toBe(3)
    expect(payload.cost.total_duration_ms).toBe(30_000)
    expect(payload.exceeds_200k_tokens).toBe(true)
  })

  test("a session-less window still produces a valid payload", () => {
    const payload = claudeCodeInput(ctx())
    expect(payload.session_id).toBe("")
    expect(payload.cost.total_cost_usd).toBe(0)
    expect(payload.exceeds_200k_tokens).toBe(false)
  })
})

const settle = () => new Promise<void>((done) => setTimeout(done, 0))

describe("the runner keeps the command off the draw path", () => {
  const harness = (config: Parameters<typeof createRunner>[0] = { run: "x" }) => {
    let clock = 0
    let calls = 0
    const seen: string[] = []
    let resolve: ((value: string) => void) | undefined
    let reject: ((err: Error) => void) | undefined
    let painted = 0
    const runner = createRunner(config, {
      exec: (_command, stdin) => {
        calls++
        seen.push(stdin)
        return new Promise<string>((res, rej) => {
          resolve = res
          reject = rej
        })
      },
      now: () => clock,
      onValue: () => painted++,
    })
    return {
      runner,
      calls: () => calls,
      stdin: () => seen,
      painted: () => painted,
      advance: (ms: number) => {
        clock += ms
      },
      // The runner's then/catch/finally chain settles over several microtask turns; a macrotask
      // tick flushes all of them, including the one that clears the in-flight flag.
      finish: async (out: string) => {
        resolve?.(out)
        await settle()
      },
      fail: async () => {
        reject?.(new Error("boom"))
        await settle()
      },
    }
  }

  test("runs once and then not again until the interval has passed", async () => {
    const h = harness({ run: "x", intervalMs: 1000 })
    h.runner.maybeRun(ctx())
    await h.finish("one")
    expect(h.calls()).toBe(1)
    expect(h.runner.value()).toBe("one")

    h.runner.maybeRun(ctx())
    expect(h.calls()).toBe(1) // too soon
    h.advance(1000)
    h.runner.maybeRun(ctx())
    expect(h.calls()).toBe(2)
  })

  // However eager the config, a command cannot be asked to run more than four times a second.
  test("the interval has a floor, so a zero cannot spawn a process per frame", () => {
    const h = harness({ run: "x", intervalMs: 0 })
    h.runner.maybeRun(ctx())
    expect(h.calls()).toBe(1)
    h.advance(100)
    h.runner.maybeRun(ctx())
    expect(h.calls()).toBe(1)
  })

  // A slow script must make the value stale, never the interface.
  test("a run still in flight is not started again", () => {
    const h = harness({ run: "x", intervalMs: 0 })
    h.runner.maybeRun(ctx())
    h.advance(10_000)
    h.runner.maybeRun(ctx())
    expect(h.calls()).toBe(1)
  })

  test("a repaint happens only when the value actually changes", async () => {
    const h = harness({ run: "x", intervalMs: 250 })
    h.runner.maybeRun(ctx())
    await h.finish("same")
    expect(h.painted()).toBe(1)

    h.advance(300)
    h.runner.maybeRun(ctx())
    await h.finish("same")
    expect(h.painted()).toBe(1)

    h.advance(300)
    h.runner.maybeRun(ctx())
    await h.finish("different")
    expect(h.painted()).toBe(2)
  })

  test("a failing command leaves the last good value in place", async () => {
    const h = harness({ run: "x", intervalMs: 250 })
    h.runner.maybeRun(ctx())
    await h.finish("good")
    h.advance(300)
    h.runner.maybeRun(ctx())
    await h.fail()
    expect(h.runner.value()).toBe("good")
  })

  test("the Claude Code payload is what reaches stdin, and can be switched off", async () => {
    const compat = harness({ run: "x" })
    compat.runner.maybeRun(ctx())
    expect(JSON.parse(compat.stdin()[0] as string).hook_event_name).toBe("Status")

    const plain = harness({ run: "x", claudeCodeCompat: false })
    plain.runner.maybeRun(ctx())
    expect(plain.stdin()[0]).toBe("")
  })

  test("a disposed runner neither runs nor updates", async () => {
    const h = harness({ run: "x", intervalMs: 250 })
    h.runner.maybeRun(ctx())
    h.runner.dispose()
    await h.finish("late")
    expect(h.runner.value()).toBe("")
    h.advance(300)
    h.runner.maybeRun(ctx())
    expect(h.calls()).toBe(1)
  })
})

describe("the real shell", () => {
  test("returns stdout and receives stdin", async () => {
    const out = await execShell("cat", '{"a":1}', 2000)
    expect(out.trim()).toBe('{"a":1}')
  })

  test("a non-zero exit is an error, so the last good value survives", () => {
    expect(execShell("exit 3", "", 2000)).rejects.toThrow("exit 3")
  })
})
