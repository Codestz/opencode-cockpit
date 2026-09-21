/**
 * Three bugs the unit tests missed and the first real run against OpenCode 1.18.31 caught. Each test
 * is the smallest reproduction of what was seen.
 */

import { describe, expect, test } from "bun:test"
import { paint } from "../src/cli/ansi.ts"
import { type Io, update } from "../src/cli/run.ts"
import { installedVersion, specDir } from "../src/core/cache.ts"
import { memoryDisk } from "../src/core/disk.ts"
import { buildPlan, collectPlugins } from "../src/core/plan.ts"
import { fetchLatest } from "../src/core/registry.ts"
import { parseSpec } from "../src/core/spec.ts"
import { reviewRows } from "../src/core/view/layout.ts"

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
})
