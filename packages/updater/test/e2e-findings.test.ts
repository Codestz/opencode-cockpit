/**
 * Three bugs the unit tests missed and the first real run against OpenCode 1.18.31 caught. Each test
 * is the smallest reproduction of what was seen.
 */

import { describe, expect, test } from "bun:test"
import { paint } from "../src/cli/ansi.ts"
import { type Io, update } from "../src/cli/run.ts"
import { applyPlan, failureReason, remedyFor } from "../src/core/apply.ts"
import { installedVersion, specDir } from "../src/core/cache.ts"
import { memoryDisk } from "../src/core/disk.ts"
import { gather } from "../src/core/gather.ts"
import { buildPlan, collectPlugins } from "../src/core/plan.ts"
import { fetchLatest } from "../src/core/registry.ts"
import { parseSpec } from "../src/core/spec.ts"
import { keyRow, listRows, reviewRows } from "../src/core/view/layout.ts"

const CACHE = "/home/me/.cache/opencode"

describe("seen against a real install", () => {
  test("a bare spec is installed as name@latest, so that is where its version is", () => {
    expect(specDir(CACHE, "opencode-cockpit")).toBe(`${CACHE}/packages/opencode-cockpit@latest`)
    expect(specDir(CACHE, "@scope/x")).toBe(`${CACHE}/packages/@scope/x@latest`)
    expect(specDir(CACHE, "opencode-cockpit@0.4.2")).toBe(`${CACHE}/packages/opencode-cockpit@0.4.2`)
    const disk = memoryDisk({
      [`${CACHE}/packages/opencode-cockpit@latest/node_modules/opencode-cockpit/package.json`]:
        '{"name":"opencode-cockpit","version":"0.4.2"}',
    })
    expect(installedVersion(disk, CACHE, "opencode-cockpit", "opencode-cockpit")).toBe("0.4.2")
  })

  test("asks the registry in a way `/latest` answers: plain JSON, scoped name encoded", async () => {
    const seen: { url: string; accept: string | null }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      const accept = new Headers(init?.headers).get("accept")
      seen.push({ url, accept })
      // What npm did on 2026-09-21: the abbreviated media type is refused on this endpoint.
      if (accept?.includes("vnd.npm.install-v1")) return new Response("", { status: 406 })
      return Response.json({ version: "0.4.3" })
    }) as unknown as typeof fetch
    expect(await fetchLatest("@opencode-cockpit/shell", { fetch: fake })).toBe("0.4.3")
    expect(seen[0]?.url).toBe("https://registry.npmjs.org/@opencode-cockpit%2fshell/latest")
  })

  test("an unreachable registry is never reported as everything current", async () => {
    const files: Record<string, string> = {
      "/home/me/.config/opencode/opencode.jsonc": '{"plugin": ["opencode-cockpit"]}',
    }
    const out: string[] = []
    const io: Io = {
      env: {},
      home: "/home/me",
      cwd: "/home/me",
      disk: memoryDisk(files),
      worktree: () => undefined,
      fetchLatest: async (names) => new Map(names.map((n) => [n, undefined])),
      opencode: async () => ({ status: 0, output: "" }),
      remove: () => {},
      write: (text) => out.push(text),
      width: 100,
      color: false,
    }
    expect(await update([], io)).toBe(1)
    expect(out.join("")).not.toContain("Everything is current")
    expect(out.join("")).toContain("Could not reach the registry for opencode-cockpit.")
  })

  test("a long path keeps its end, where the file name is", () => {
    const deep = "/private/tmp/somewhere/very/deep/and/long/config/opencode/tui.json"
    const [plan] = buildPlan({
      plugins: [{ name: "x", source: "npm", running: "1.0.0" }],
      entries: [{ file: { path: deep, scope: "global", owner: "command", cwd: "/" }, spec: parseSpec("x") }],
      published: new Map([["x", "1.1.0"]]),
      cacheDirs: new Map([["x", [`/private/tmp/somewhere/very/deep/cache/opencode/packages/x@latest`]]]),
    })
    const text = paint(reviewRows(plan ? [plan] : [], 60, "/home/me"), false)
    expect(text).toMatch(/ {2}…\S*\/opencode\/tui\.json {2}/)
    expect(text).toMatch(/remove {2}…\S*\/packages\/x@latest\n/)
  })

  test("a local plugin the host calls file:///x and the config calls /x is one plugin", () => {
    const plugins = collectPlugins(
      [{ id: "shell", source: "file", spec: "file:///work/plugins/shell" }],
      [
        {
          file: { path: "/c/tui.json", scope: "global", owner: "command", cwd: "/" },
          spec: parseSpec("/work/plugins/shell/"),
        },
      ],
    )
    expect(plugins).toEqual([{ name: "/work/plugins/shell", source: "file" }])
  })

  // Seen in a real OpenCode, against the approved mock (a screenshot, not a smoke test: text alone
  // cannot show any of these).
  test("the cursor is an accent mark in the margin, as in the mock", () => {
    const plans = buildPlan({
      plugins: [
        { name: "a", source: "npm", running: "1.0.0" },
        { name: "b", source: "npm", running: "1.0.0" },
      ],
      entries: [],
      published: new Map([
        ["a", "1.0.0"],
        ["b", "1.0.0"],
      ]),
      cacheDirs: new Map(),
    })
    const [, first, second] = listRows(plans, 80, { cursor: 0, selected: new Set() })
    expect(first?.runs[0]).toMatchObject({ text: "▌", tone: "accent" })
    expect(first?.runs[0]?.faint).toBeFalsy()
    expect(second?.runs[0]?.text).toBe(" ")
    // The box keeps a gap before the name: `[x]opencode-cockpit` shipped once.
    const selected = listRows(plans, 80, { cursor: 0, selected: new Set(["a"]) })
    expect(selected.map((r) => r.runs.map((x) => x.text).join("")).join("\n")).not.toMatch(/\][a-z]/)
  })

  test("what the screen cannot act on is faint, not merely quiet", () => {
    const plans = buildPlan({
      plugins: [
        { name: "current", source: "npm", running: "1.0.0" },
        { name: "/work/plugin", source: "file" },
      ],
      entries: [],
      published: new Map([["current", "1.0.0"]]),
      cacheDirs: new Map(),
    })
    const rows = listRows(plans, 80)
    const row = (name: string) => rows.find((r) => r.target === name)
    expect(row("current")?.runs.every((run) => !run.faint)).toBe(true)
    expect(
      row("/work/plugin")
        ?.runs.filter((run) => run.text.trim())
        .every((run) => run.faint),
    ).toBe(true)
  })

  test("a local plugin is called by its package name, and its path is the config", async () => {
    const found = await gather({
      env: {},
      home: "/home/me",
      disk: memoryDisk({
        "/home/me/.config/opencode/tui.json": '{"plugin": ["/work/cockpit/packages/opencode"]}',
        "/work/cockpit/packages/opencode/package.json": '{"name": "opencode-cockpit"}',
      }),
      fetchLatest: async () => new Map(),
    })
    const text = listRows(found.plans, 90)
      .map((r) => r.runs.map((run) => run.text).join(""))
      .join("\n")
    // A long path is cut from the left, keeping the end that names the package.
    expect(text).toMatch(/^opencode-cockpit +…\S*packages\/opencode +local/m)
  })

  test("keys read like Shell and Review: [key] Label, and a hint never splits", () => {
    const row = keyRow(
      [
        ["space", "Select"],
        ["enter", "Review"],
        ["esc", "Close"],
      ],
      28,
    )
    expect(
      row.runs
        .map((r) => r.text)
        .join("")
        .trimEnd(),
    ).toBe("[space] Select")
    expect(row.runs.slice(0, 2)).toEqual([
      { text: "[space]", tone: "accent", bold: true },
      { text: " Select", tone: "muted" },
    ])
    // "[enter] Review" does not fit in what is left of 28: it is dropped whole, not cut.
    expect(row.runs.some((r) => r.text.startsWith("[enter]"))).toBe(false)
  })

  test("the review never cuts the new spec: the path gives way first, from the left", () => {
    const tui = {
      path: "/home/me/.config/opencode/tui.json",
      scope: "global" as const,
      owner: "command" as const,
      cwd: "/",
    }
    const [plan] = buildPlan({
      plugins: [{ name: "opencode-subagent-statusline", source: "npm", running: "1.2.3" }],
      entries: [{ file: tui, spec: parseSpec("opencode-subagent-statusline@latest") }],
      published: new Map([["opencode-subagent-statusline", "1.3.0"]]),
      cacheDirs: new Map(),
    })
    const text = paint(reviewRows(plan ? [plan] : [], 100, "/home/me"), false)
    expect(text).toContain("opencode-subagent-statusline@latest")
    expect(text).toContain("opencode-subagent-statusline@1.3.0")
    const narrow = paint(reviewRows(plan ? [plan] : [], 90, "/home/me"), false)
    expect(narrow).toContain("opencode-subagent-statusline@1.3.0")
    expect(narrow).toMatch(/…\S*tui\.json/)
  })

  test("one long local path does not push every version away from its spec", () => {
    const f = { path: "/c/o.json", scope: "global" as const, owner: "command" as const, cwd: "/" }
    const long = "/Users/someone/Documents/PersonalProjects/opencode-cockpit/packages/opencode"
    const plans = buildPlan({
      plugins: [
        { name: "x", source: "npm", running: "1.2.3" },
        { name: long, source: "file", label: "opencode-cockpit" },
      ],
      entries: [
        { file: f, spec: parseSpec("x@latest") },
        { file: f, spec: parseSpec(long) },
      ],
      published: new Map([["x", "1.3.0"]]),
      cacheDirs: new Map(),
    })
    const row = paint(listRows(plans, 110), false)
      .split("\n")
      .find((l) => l.startsWith("x "))
    expect(row).toBeDefined()
    // `latest  ⚠` and `1.3.0` sit within a few columns of each other, whatever the path's length.
    const gap = (row ?? "").indexOf("1.3.0") - ((row ?? "").indexOf("⚠") + 1)
    expect(gap).toBeLessThanOrEqual(24)
  })

  /** What `opencode plugin` printed on a real machine whose npm cache had files it did not own. */
  const EACCES_OUTPUT = [
    "\x1b[0m",
    "┌  Install plugin opencode-command-hooks@0.7.1",
    "\x1b[?25l│",
    "◒  Installing plugin package\x1b[999D\x1b[J◐  Installing plugin package\x1b[999D\x1b[J■  Install failed",
    "\x1b[?25h│",
    '■  Could not install "opencode-command-hooks@0.7.1"',
    "│",
    "■  EACCES: permission denied, rename '/Users/me/.npm/_cacache/tmp/a62a' -> '/Users/me/.npm/_cacache/content-v2/sha512/2a/45/0fe2'",
    "│",
    "└  Done",
    "",
  ].join("\n")

  test("a failed install names its cause, not clack's closing `└ Done`", () => {
    const why = failureReason(EACCES_OUTPUT)
    expect(why).toStartWith("EACCES: permission denied, rename")
    expect(why).not.toContain("Done")
    expect(failureReason("\x1b[0m┌  x\n│\n└  Done\n")).toBe("x")
  })

  test("npm's cache owned by someone else comes with the command that fixes it, before the retry", async () => {
    expect(remedyFor(EACCES_OUTPUT)).toBe('sudo chown -R "$(whoami)" ~/.npm')
    expect(remedyFor("■  ETARGET No matching version")).toBeUndefined()

    const global = {
      path: "/c/opencode.jsonc",
      scope: "global" as const,
      owner: "command" as const,
      cwd: "/",
    }
    const files: Record<string, string> = { "/c/opencode.jsonc": '{"plugin": ["hooks@0.6.1"]}' }
    const [plan] = buildPlan({
      plugins: [{ name: "hooks", source: "npm", running: "0.6.1" }],
      entries: [{ file: global, spec: parseSpec("hooks@0.6.1") }],
      published: new Map([["hooks", "0.7.1"]]),
      cacheDirs: new Map([["hooks", ["/cache/packages/hooks@0.6.1"]]]),
    })
    if (!plan) throw new Error("no plan")
    const removed: string[] = []
    const outcome = await applyPlan(
      plan,
      { root: "/cache", files: [global] },
      {
        disk: memoryDisk(files),
        opencode: async () => ({ status: 1, output: EACCES_OUTPUT }),
        remove: (dir) => removed.push(dir),
      },
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.problems[0]).toStartWith("opencode plugin hooks@0.7.1 -f -g failed: EACCES")
    expect(outcome.fixes).toEqual(['sudo chown -R "$(whoami)" ~/.npm', "opencode plugin hooks@0.7.1 -f -g"])
    expect(removed).toEqual([]) // the old copy stays: it is the one that still runs
  })

  test("one config says, two configs say", async () => {
    const global = {
      path: "/c/opencode.jsonc",
      scope: "global" as const,
      owner: "command" as const,
      cwd: "/",
    }
    const files: Record<string, string> = { "/c/opencode.jsonc": '{"plugin": ["hooks@0.6.1"]}' }
    const [plan] = buildPlan({
      plugins: [{ name: "hooks", source: "npm", running: "0.6.1" }],
      entries: [{ file: global, spec: parseSpec("hooks@0.6.1") }],
      published: new Map([["hooks", "0.7.1"]]),
      cacheDirs: new Map(),
    })
    if (!plan) throw new Error("no plan")
    const outcome = await applyPlan(
      plan,
      { root: "/cache", files: [global] },
      {
        disk: memoryDisk(files),
        opencode: async () => {
          files["/c/opencode.jsonc"] = '{"plugin": ["hooks@0.7.1"]}'
          return { status: 0, output: "" }
        },
        remove: () => {},
      },
    )
    expect(outcome.confirmed).toEqual(["1 config says @0.7.1"])
  })
})
