import { describe, expect, test } from "bun:test"
import { type ClaudeCodeStatusInput, claudeCodeInput } from "../src/core/claude-code.ts"
import { cleanOutput, createRunner, execShell, outputRows } from "../src/core/command.ts"
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
  test("keeps every row and drops only the trailing blank space", () => {
    expect(cleanOutput("top\nbottom\n\n")).toBe("top\nbottom")
    expect(cleanOutput("")).toBe("")
    expect(outputRows(cleanOutput("top\r\nbottom\n"))).toEqual(["top", "bottom"])
    expect(outputRows("")).toEqual([])
  })

  /**
   * The escapes are deliberately kept: they are parsed into styled runs when the segment draws,
   * so a script someone already tuned for Claude Code keeps the colours its author chose.
   */
  test("keeps the colour escapes a ported script emits", () => {
    const esc = String.fromCharCode(27)
    expect(cleanOutput(`${esc}[32mmain${esc}[0m`)).toContain(`${esc}[32m`)
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
    expect(payload.workspace).toEqual({
      current_dir: "/w/app/src",
      project_dir: "/w/app",
      git_worktree: "/w/app",
    })
    expect(payload.model.id).toBe("claude-opus-5")
    expect(payload.model.display_name).toBe("claude-opus-5")
    expect(payload.cost.total_cost_usd).toBe(1.5)
    expect(payload.cost.total_lines_added).toBe(40)
    expect(payload.cost.total_lines_removed).toBe(3)
    expect(payload.cost.total_duration_ms).toBe(30_000)
    expect(payload.exceeds_200k_tokens).toBe(true)
  })

  /**
   * The fields a real statusline actually draws from. A script wanting a capacity bar reads
   * `context_window.used_percentage`; without it, it either draws nothing or divides by a number
   * it had to guess.
   */
  test("carries the context window when one was declared", () => {
    const payload = claudeCodeInput(
      ctx({
        session: {
          id: "ses_1",
          status: "idle",
          cost: 0,
          priced: true,
          messages: 1,
          model: { providerID: "p", modelID: "m", contextLimit: 200_000 },
          tokens: { input: 30_000, output: 10_000, reasoning: 0, cache: { read: 60_000, write: 0 } },
          diff: { files: 0, additions: 0, deletions: 0 },
          todo: { total: 0, completed: 0 },
        },
      }),
    )
    expect(payload.context_window).toEqual({
      used_percentage: 50,
      remaining_percentage: 50,
      context_window_size: 200_000,
      total_input_tokens: 90_000,
      total_output_tokens: 10_000,
    })
    expect(payload.current_usage).toEqual({
      input_tokens: 30_000,
      output_tokens: 10_000,
      cache_creation_tokens: 0,
      cache_read_tokens: 60_000,
    })
  })

  // Behind a proxy nobody declares a window; a script dividing by a made-up size draws a
  // confident wrong bar, which is worse than the field being absent.
  test("omits the context window when nobody declared one", () => {
    const payload = claudeCodeInput(
      ctx({
        session: {
          id: "ses_1",
          status: "idle",
          cost: 0,
          priced: false,
          messages: 1,
          model: { providerID: "p", modelID: "m" },
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          diff: { files: 0, additions: 0, deletions: 0 },
          todo: { total: 0, completed: 0 },
        },
      }),
    )
    expect(payload.context_window).toBeUndefined()
    expect(payload.current_usage).toBeDefined()
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
