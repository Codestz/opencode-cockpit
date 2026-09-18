import { describe, expect, test } from "bun:test"
import { PRESETS, presetByName, presetForCommand } from "../src/modules/shell/watch/presets.ts"
import { compileRule, Watcher } from "../src/modules/shell/watch/watcher.ts"

const watcherFor = (preset: string) => {
  const hit = presetByName(preset)
  if (!hit) throw new Error(`no preset ${preset}`)
  return new Watcher(compileRule(hit.rule), preset)
}

/** Feeds lines and returns every reported change. */
const feed = (watcher: Watcher, lines: string[]) =>
  lines.flatMap((line) => {
    const change = watcher.line(line)
    return change ? [`${change.previous}→${change.current}`] : []
  })

describe("watch presets", () => {
  test("pick a preset from the command", () => {
    expect(presetForCommand("tsc --noEmit --watch")?.name).toBe("tsc")
    expect(presetForCommand("npx vitest --watch")?.name).toBe("vitest")
    expect(presetForCommand("cargo watch -x check")?.name).toBe("cargo")
    expect(presetForCommand("./gradlew build --continuous")?.name).toBe("gradle")
    expect(presetForCommand("docker compose up")?.name).toBe("docker-compose")
    expect(presetForCommand("npm run dev")).toBeUndefined()
  })

  test("every preset compiles and has something to match", () => {
    for (const preset of PRESETS) {
      expect(() => compileRule(preset.rule)).not.toThrow()
      expect(Boolean(preset.rule.done || preset.rule.idleSeconds)).toBe(true)
      expect(Boolean(preset.rule.fail || preset.rule.ok)).toBe(true)
    }
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length)
  })

  test("tsc --watch: clean, then broken, then fixed", () => {
    const watcher = watcherFor("tsc")
    expect(
      feed(watcher, ["Starting compilation in watch mode...", "Found 0 errors. Watching for file changes."]),
    ).toEqual(["pending→ok"])
    expect(watcher.state()).toMatchObject({ status: "ok", runs: 1, preset: "tsc" })

    const broke = feed(watcher, [
      "File change detected. Starting incremental compilation...",
      "src/auth.ts(42,3): error TS2339: Property 'id' does not exist on type 'User'.",
      "Found 1 error. Watching for file changes.",
    ])
    expect(broke).toEqual(["ok→fail"])
    expect(watcher.state().summary).toContain("error TS2339")

    expect(feed(watcher, ["Found 0 errors. Watching for file changes."])).toEqual(["fail→ok"])
  })

  test("a repeating clean run reports nothing", () => {
    const watcher = watcherFor("tsc")
    feed(watcher, ["Found 0 errors. Watching for file changes."])
    const quiet = feed(
      watcher,
      Array.from({ length: 20 }, () => "Found 0 errors. Watching for file changes."),
    )
    expect(quiet).toEqual([])
    expect(watcher.state().runs).toBe(21)
  })

  test("a different error during an already failing run is still news", () => {
    const watcher = watcherFor("tsc")
    feed(watcher, ["src/a.ts(1,1): error TS1005: ';' expected.", "Found 1 error. Watching for file changes."])
    const second = watcher.line("src/b.ts(9,2): error TS2554: Expected 2 arguments.")
    expect(second).toBeUndefined() // mid-run
    const settled = watcher.line("Found 1 error. Watching for file changes.")
    expect(settled).toMatchObject({ previous: "fail", current: "fail" })
    expect(settled?.summary).toContain("TS2554")
  })

  test("vitest and jest summaries", () => {
    const vitest = watcherFor("vitest")
    expect(feed(vitest, ["Test Files  3 passed (3)", "Tests  12 passed (12)"])).toEqual(["pending→ok"])
    expect(feed(vitest, ["Test Files  1 failed | 2 passed (3)"])).toEqual(["ok→fail"])

    const jest = watcherFor("jest")
    expect(feed(jest, ["Tests:       2 passed, 2 total"])).toEqual(["pending→ok"])
    expect(feed(jest, ["Tests:       1 failed, 1 passed, 2 total"])).toEqual(["ok→fail"])
  })

  test("cargo, go and gradle", () => {
    expect(feed(watcherFor("cargo"), ["    Finished dev [unoptimized] target(s) in 1.24s"])).toEqual([
      "pending→ok",
    ])
    // cargo prints no summary line on failure, so each error line both ends the run and fails it;
    // the second is reported too because it is a different error.
    expect(
      feed(watcherFor("cargo"), ["error[E0308]: mismatched types", "error: could not compile `app`"]),
    ).toEqual(["pending→fail", "fail→fail"])
    expect(feed(watcherFor("go"), ["ok  	example.com/pkg	0.31s"])).toEqual(["pending→ok"])
    expect(feed(watcherFor("gradle"), ["BUILD FAILED in 3s"])).toEqual(["pending→fail"])
  })

  test("without a done pattern, silence ends the run", () => {
    const compose = watcherFor("docker-compose")
    expect(compose.idleMs).toBe(5000)
    expect(compose.line("api-1  | Started on port 3000")).toBeUndefined()
    expect(compose.idle()).toMatchObject({ previous: "pending", current: "ok" })
  })

  test("a watched process that dies is a failure", () => {
    const watcher = watcherFor("vite")
    feed(watcher, ["  VITE v7.3.1  ready in 431 ms"])
    expect(watcher.state().status).toBe("ok")
    const crash = watcher.exited(1, undefined)
    expect(crash).toMatchObject({ previous: "ok", current: "fail" })
    expect(crash?.summary).toContain("exit code 1")
  })

  test("a clean exit keeps the last known status", () => {
    const watcher = watcherFor("tsc")
    feed(watcher, ["Found 0 errors. Watching for file changes."])
    expect(watcher.exited(0, undefined)).toBeUndefined()
    expect(watcher.state().status).toBe("ok")
  })

  test("a custom rule needs no preset", () => {
    const watcher = new Watcher(compileRule({ done: "^DONE", fail: "PANIC", ok: "^ALL GOOD" }))
    expect(feed(watcher, ["PANIC: disk on fire", "DONE"])).toEqual(["pending→fail"])
    expect(feed(watcher, ["ALL GOOD", "DONE"])).toEqual(["fail→ok"])
    expect(watcher.state().preset).toBeUndefined()
  })
})
