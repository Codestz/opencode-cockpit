import { describe, expect, test } from "bun:test"
import { paint } from "../src/cli/ansi.ts"
import { type Io, update } from "../src/cli/run.ts"
import type { ConfigFile } from "../src/core/configs.ts"
import { memoryDisk } from "../src/core/disk.ts"
import { buildPlan } from "../src/core/plan.ts"
import { parseSpec } from "../src/core/spec.ts"
import { verify } from "../src/core/verify.ts"
import { listRows, resultRows, reviewRows } from "../src/core/view/layout.ts"
import { rowWidth } from "../src/core/view/rows.ts"

const HOME = "/home/me"
const CONFIG = `${HOME}/.config/opencode`
const CACHE = `${HOME}/.cache/opencode`
const PKGS = `${CACHE}/packages`

const installed = (spec: string, name: string, version: string) => ({
  [`${PKGS}/${spec}/node_modules/${name}/package.json`]: JSON.stringify({ name, version }),
})

/** The machine from the investigation: `@latest` frozen at 0.1.2, plus a plugin pinned behind. */
function machine(): Record<string, string> {
  return {
    [`${CACHE}/version`]: "18",
    [`${CONFIG}/opencode.jsonc`]: `{\n  // mine\n  "plugin": ["opencode-cockpit@latest", "opencode-foo@1.2.0", "bar@2.0.0"],\n}`,
    [`${CONFIG}/tui.json`]: `{"plugin": ["opencode-cockpit@latest"]}`,
    ...installed("opencode-cockpit@latest", "opencode-cockpit", "0.1.2"),
    ...installed("opencode-cockpit@0.2.2", "opencode-cockpit", "0.2.2"),
    ...installed("opencode-foo@1.2.0", "opencode-foo", "1.2.0"),
    ...installed("bar@2.0.0", "bar", "2.0.0"),
  }
}

const PUBLISHED = new Map([
  ["opencode-cockpit", "0.5.0"],
  ["opencode-foo", "1.3.0"],
  ["bar", "2.0.0"],
])

/**
 * A fake `opencode plugin <spec> -f -g` that does what the real one was seen to do: replace the
 * entry in every global file that has it, and install the new spec's directory.
 */
function fakeOpencode(files: Record<string, string>, calls: string[][], broken = false) {
  return async (args: readonly string[]) => {
    calls.push([...args])
    if (args[1] === "--help") return { status: 0, output: "  -f, --force  replace existing plugin version" }
    if (broken) return { status: 1, output: "Failed updating plugin config" }
    const to = parseSpec(args[1] as string)
    if (to.kind !== "npm" || to.pin.type !== "exact") throw new Error(`fake got ${args[1]}`)
    for (const path of [`${CONFIG}/opencode.jsonc`, `${CONFIG}/tui.json`]) {
      const text = files[path]
      if (!text) continue
      files[path] = text.replace(new RegExp(`"${to.name}(@[^"]*)?"`, "g"), `"${args[1]}"`)
    }
    Object.assign(files, installed(args[1] as string, to.name, to.pin.version))
    return { status: 0, output: `Installed ${args[1]}` }
  }
}

function io(
  files: Record<string, string>,
  over: Partial<Io> = {},
): Io & { out: string[]; calls: string[][] } {
  const out: string[] = []
  const calls: string[][] = []
  const disk = memoryDisk(files)
  return {
    env: {},
    home: HOME,
    cwd: HOME,
    disk: { read: (p) => files[p] ?? disk.read(p), list: (p) => memoryDisk(files).list(p) },
    worktree: () => undefined,
    fetchLatest: async (names) => new Map(names.map((n) => [n, PUBLISHED.get(n)])),
    opencode: fakeOpencode(files, calls),
    remove(dir) {
      for (const path of Object.keys(files)) if (path.startsWith(`${dir}/`)) delete files[path]
    },
    ask: async () => true,
    write: (text) => out.push(text),
    width: 100,
    color: false,
    out,
    calls,
    ...over,
  }
}

describe("layout", () => {
  const file: ConfigFile = { path: `${CONFIG}/opencode.jsonc`, scope: "global", owner: "command", cwd: HOME }
  const plans = buildPlan({
    plugins: [
      { name: "opencode-cockpit", source: "npm", running: "0.1.2" },
      { name: "a-very-long-plugin-name-that-will-not-fit-in-its-column", source: "npm", running: "1.0.0" },
      { name: "priv", source: "npm", running: "1.0.0" },
      { name: "auth", source: "internal" },
    ],
    entries: [
      { file, spec: parseSpec("opencode-cockpit") },
      { file, spec: parseSpec("a-very-long-plugin-name-that-will-not-fit-in-its-column@1.0.0") },
      { file, spec: parseSpec("priv@1.0.0") },
    ],
    published: new Map([
      ["opencode-cockpit", "0.5.0"],
      ["a-very-long-plugin-name-that-will-not-fit-in-its-column", "1.0.0"],
      ["priv", undefined],
    ]),
    cacheDirs: new Map([["opencode-cockpit", [`${PKGS}/opencode-cockpit@latest`]]]),
  })

  test("every row of every screen is exactly the width it was given", () => {
    const outcomes = plans.map((plan) => verify(plan, { entries: [], dirs: plan.remove }))
    for (const width of [60, 80, 100, 140]) {
      const rows = [
        ...listRows(plans, width),
        ...listRows(plans, width, { cursor: 1, selected: new Set(["opencode-cockpit"]) }),
        ...reviewRows(plans, width, HOME),
        ...resultRows(plans, outcomes, width),
      ]
      for (const row of rows) expect(rowWidth(row)).toBe(width)
    }
  })

  test("the list says what the mock says", () => {
    const text = paint(listRows(plans, 100), false)
    expect(text).toContain("opencode-cockpit                    0.1.2     latest  ⚠  0.5.0       ↑")
    expect(text).toContain("priv                                1.0.0     @1.0.0     ?           unreachable")
    // Every column starts where its header does, whatever the widest entry made the widths.
    const [head = "", ...body] = text.split("\n")
    for (const title of ["running", "config", "published"]) {
      const at = head.indexOf(title)
      for (const line of body.filter((l) => l.startsWith("opencode-cockpit") || l.startsWith("priv"))) {
        expect(line[at - 1]).toBe(" ")
        expect(line[at]).not.toBe(" ")
      }
    }
    // OpenCode's own parts are one line, not a row each: in a real OpenCode there were twelve.
    expect(text).toContain("1 built into OpenCode")
    expect(text).not.toContain("auth")
  })
})

describe("update", () => {
  test("updates what is behind, sweeps the frozen directories, and confirms it on disk", async () => {
    const files = machine()
    const cli = io(files)
    expect(await update(["update"], cli)).toBe(0)

    expect(cli.calls.slice(1)).toEqual([
      ["plugin", "opencode-cockpit@0.5.0", "-f", "-g"],
      ["plugin", "opencode-foo@1.3.0", "-f", "-g"],
    ])
    expect(files[`${CONFIG}/tui.json`]).toBe(`{"plugin": ["opencode-cockpit@0.5.0"]}`)
    expect(files[`${CONFIG}/opencode.jsonc`]).toContain("// mine")
    const dirs = memoryDisk(files).list(PKGS)
    expect(dirs).toEqual(["bar@2.0.0", "opencode-cockpit@0.5.0", "opencode-foo@1.3.0"])

    const out = cli.out.join("")
    expect(out).toContain("✓  2 configs say @0.5.0 · 2 dirs removed")
    expect(out).toContain("Restart OpenCode to load opencode-cockpit 0.5.0, opencode-foo 1.3.0.")
  })

  test("a dry run writes nothing", async () => {
    const files = machine()
    const before = JSON.stringify(files)
    const cli = io(files)
    expect(await update(["--dry-run"], cli)).toBe(0)
    expect(JSON.stringify(files)).toBe(before)
    expect(cli.calls).toEqual([])
    expect(cli.out.join("")).toContain("remove  ~/.cache/opencode/packages/opencode-cockpit@latest")
  })

  test("--only touches one plugin", async () => {
    const cli = io(machine())
    expect(await update(["--only", "opencode-foo", "--yes"], cli)).toBe(0)
    expect(cli.calls.slice(1)).toEqual([["plugin", "opencode-foo@1.3.0", "-f", "-g"]])
  })

  test("declining writes nothing", async () => {
    const files = machine()
    const cli = io(files, { ask: async () => false })
    expect(await update([], cli)).toBe(0)
    expect(cli.calls).toEqual([["plugin", "--help"]])
  })

  test("with nobody to ask it does not assume yes", async () => {
    const { ask: _, ...rest } = io(machine())
    const cli = rest as Io & { out: string[]; calls: string[][] }
    expect(await update([], cli)).toBe(1)
    expect(cli.calls).toEqual([["plugin", "--help"]])
    expect(cli.out.join("")).toContain("Rerun with --yes")
  })

  test("without opencode it writes nothing and prints what to do by hand", async () => {
    const cli = io(machine(), { opencode: async () => ({ status: null, output: "ENOENT" }) })
    expect(await update([], cli)).toBe(1)
    const out = cli.out.join("")
    expect(out).toContain("opencode plugin opencode-cockpit@0.5.0 -f -g")
    expect(out).toContain(`rm -rf '${PKGS}/opencode-cockpit@latest'`)
  })

  test("a failed command keeps the old copy and says why", async () => {
    const files = machine()
    const calls: string[][] = []
    const cli = io(files, { opencode: fakeOpencode(files, calls, true) })
    expect(await update(["--only", "opencode-cockpit", "-y"], cli)).toBe(1)
    expect(memoryDisk(files).list(PKGS)).toContain("opencode-cockpit@latest")
    expect(cli.out.join("")).toContain("exited 1: Failed updating plugin config")
  })

  test("an unknown cache layout updates configs but deletes nothing", async () => {
    const files = { ...machine(), [`${CACHE}/version`]: "19" }
    const cli = io(files)
    expect(await update(["-y"], cli)).toBe(0)
    expect(memoryDisk(files).list(PKGS)).toContain("opencode-cockpit@latest")
    expect(cli.out.join("")).toContain("cache layout is 19, not 18")
  })

  test("nothing behind is one line, not a prompt", async () => {
    const cli = io({
      [`${CONFIG}/opencode.json`]: `{"plugin": ["bar@2.0.0"]}`,
      ...installed("bar@2.0.0", "bar", "2.0.0"),
    })
    expect(await update([], cli)).toBe(0)
    expect(cli.out.join("")).toContain("Everything is current.")
    expect(cli.calls).toEqual([])
  })
})
