import { describe, expect, test } from "bun:test"
import type { ConfigEntry, ConfigFile } from "../src/core/configs.ts"
import { buildPlan, collectPlugins, type PlanInput, type PluginPlan } from "../src/core/plan.ts"
import { parseSpec } from "../src/core/spec.ts"
import { commandLine, verify } from "../src/core/verify.ts"

const CACHE = "/home/me/.cache/opencode/packages"
const file = (
  path: string,
  scope: "global" | "project",
  owner: "command" | "manual" = "command",
): ConfigFile => ({
  path,
  scope,
  owner,
  cwd: scope === "global" ? "/home/me" : "/work/app",
})
const GLOBAL = file("/home/me/.config/opencode/opencode.jsonc", "global")
const GLOBAL_TUI = file("/home/me/.config/opencode/tui.json", "global")
const PROJECT_ROOT = file("/work/app/opencode.json", "project", "manual")
const entry = (f: ConfigFile, raw: string): ConfigEntry => ({ file: f, spec: parseSpec(raw) })

/** The mock's list: every kind of row. */
function mockInput(): PlanInput {
  const entries = [
    entry(GLOBAL, "opencode-cockpit"),
    entry(GLOBAL_TUI, "opencode-cockpit"),
    entry(GLOBAL, "opencode-foo@1.2.0"),
    entry(PROJECT_ROOT, "opencode-foo@1.1.0"),
    entry(GLOBAL, "@scope/bar@2.0.0"),
    entry(GLOBAL, "some-private-plugin@1.0.0"),
    entry(GLOBAL_TUI, "./plugins/x"),
  ]
  const plugins = collectPlugins(
    [
      { id: "opencode-cockpit", source: "npm", spec: "opencode-cockpit" },
      { id: "internal:auth", source: "internal", spec: "internal:auth" },
      { id: "x", source: "file", spec: "./plugins/x" },
    ],
    entries,
  ).map((p) => ({
    ...p,
    ...({
      "opencode-cockpit": { running: "0.1.2" },
      "opencode-foo": { running: "1.2.0" },
      "@scope/bar": { running: "2.0.0" },
      "some-private-plugin": { running: "1.0.0" },
    }[p.name] ?? {}),
  }))
  return {
    plugins,
    entries,
    published: new Map([
      ["opencode-cockpit", "0.5.0"],
      ["opencode-foo", "1.3.0"],
      ["@scope/bar", "2.0.0"],
      ["some-private-plugin", undefined],
    ]),
    cacheDirs: new Map([
      ["opencode-cockpit", [`${CACHE}/opencode-cockpit@0.2.2`, `${CACHE}/opencode-cockpit@latest`]],
      ["opencode-foo", [`${CACHE}/opencode-foo@1.2.0`]],
      ["@scope/bar", [`${CACHE}/@scope/bar@2.0.0`]],
    ]),
  }
}

const byName = (plans: PluginPlan[], name: string): PluginPlan => {
  const plan = plans.find((p) => p.name === name)
  if (!plan) throw new Error(`no plan for ${name}`)
  return plan
}

describe("collectPlugins", () => {
  test("a server-only plugin is found through the configs", () => {
    const names = collectPlugins([], [entry(GLOBAL, "opencode-foo@1.2.0")]).map((p) => p.name)
    expect(names).toEqual(["opencode-foo"])
  })

  test("the same plugin listed and configured is one plugin", () => {
    const plugins = collectPlugins(
      [{ id: "opencode-cockpit", source: "npm", spec: "opencode-cockpit@latest" }],
      [entry(GLOBAL, "opencode-cockpit@latest"), entry(GLOBAL_TUI, "opencode-cockpit@latest")],
    )
    expect(plugins).toEqual([{ name: "opencode-cockpit", source: "npm" }])
  })
})

describe("buildPlan", () => {
  test("classifies every kind of row", () => {
    const plans = buildPlan(mockInput())
    const states = Object.fromEntries(plans.map((p) => [p.name, p.state]))
    expect(states).toEqual({
      "opencode-cockpit": "update",
      "opencode-foo": "update",
      "@scope/bar": "current",
      "some-private-plugin": "unknown",
      "internal:auth": "internal",
      "./plugins/x": "local",
    })
    expect(
      plans
        .filter((p) => p.selected)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["opencode-cockpit", "opencode-foo"])
  })

  test("a frozen spec is rewritten to an exact version, and its stale directories go", () => {
    const cockpit = byName(buildPlan(mockInput()), "opencode-cockpit")
    expect(cockpit.frozen).toBe(true)
    expect(cockpit.changes.map((c) => [c.file.path, c.from, c.to])).toEqual([
      [GLOBAL.path, "opencode-cockpit", "opencode-cockpit@0.5.0"],
      [GLOBAL_TUI.path, "opencode-cockpit", "opencode-cockpit@0.5.0"],
    ])
    // Both global files are one command: `-f` rewrites every file of a scope at once.
    expect(cockpit.commands).toEqual([
      { cwd: "/home/me", args: ["plugin", "opencode-cockpit@0.5.0", "-f", "-g"] },
    ])
    expect(cockpit.remove).toEqual([`${CACHE}/opencode-cockpit@0.2.2`, `${CACHE}/opencode-cockpit@latest`])
  })

  test("a project's root config is a change a person makes, not a command", () => {
    const foo = byName(buildPlan(mockInput()), "opencode-foo")
    expect(foo.changes.map((c) => c.file.owner)).toEqual(["command", "manual"])
    expect(foo.commands).toHaveLength(1)
  })

  test("running the newest behind `@latest` is still a proposal: the tag will not move next time", () => {
    const plans = buildPlan({
      plugins: [{ name: "x", source: "npm", running: "1.0.0" }],
      entries: [entry(GLOBAL, "x@latest")],
      published: new Map([["x", "1.0.0"]]),
      cacheDirs: new Map([["x", [`${CACHE}/x@latest`]]]),
    })
    expect(plans[0]).toMatchObject({ state: "pin", selected: true, remove: [`${CACHE}/x@latest`] })
  })

  test("never moves a plugin backwards", () => {
    const plans = buildPlan({
      plugins: [{ name: "x", source: "npm", running: "2.0.0-beta.1" }],
      entries: [entry(GLOBAL, "x@2.0.0-beta.1")],
      published: new Map([["x", "1.9.0"]]),
      cacheDirs: new Map(),
    })
    expect(plans[0]).toMatchObject({ state: "current", selected: false, changes: [] })
  })

  test("the directory being installed is never on the removal list", () => {
    const plans = buildPlan({
      plugins: [{ name: "x", source: "npm", running: "1.0.0" }],
      entries: [entry(GLOBAL, "x@1.0.0")],
      published: new Map([["x", "1.1.0"]]),
      cacheDirs: new Map([["x", [`${CACHE}/x@1.0.0`, `${CACHE}/x@1.1.0`]]]),
    })
    expect(plans[0]?.remove).toEqual([`${CACHE}/x@1.0.0`])
  })

  test("puts what needs a decision first, and what cannot be acted on last", () => {
    const names = buildPlan(mockInput()).map((p) => p.name)
    expect(names.slice(0, 2).sort()).toEqual(["opencode-cockpit", "opencode-foo"])
    expect(names.slice(-2).sort()).toEqual(["./plugins/x", "internal:auth"])
  })
})

describe("verify", () => {
  const cockpit = () => byName(buildPlan(mockInput()), "opencode-cockpit")

  test("confirms what disk says, in the words the result row uses", () => {
    const outcome = verify(cockpit(), {
      entries: [entry(GLOBAL, "opencode-cockpit@0.5.0"), entry(GLOBAL_TUI, "opencode-cockpit@0.5.0")],
      dirs: [`${CACHE}/opencode-cockpit@0.5.0`],
    })
    expect(outcome).toEqual({
      name: "opencode-cockpit",
      ok: true,
      confirmed: ["2 configs say @0.5.0", "2 dirs removed"],
      problems: [],
      fixes: [],
    })
  })

  test("the command said Installed and nothing moved: caught, with the command that fixes it", () => {
    const outcome = verify(cockpit(), {
      entries: [entry(GLOBAL, "opencode-cockpit"), entry(GLOBAL_TUI, "opencode-cockpit@0.5.0")],
      dirs: [`${CACHE}/opencode-cockpit@latest`],
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.problems).toEqual([
      `${GLOBAL.path} still says opencode-cockpit`,
      `${CACHE}/opencode-cockpit@latest is still there`,
    ])
    expect(outcome.fixes).toEqual([
      "opencode plugin opencode-cockpit@0.5.0 -f -g",
      `rm -rf ${CACHE}/opencode-cockpit@latest`,
    ])
  })

  test("a root-level project config left on the old pin gets an edit, not a command", () => {
    const foo = byName(buildPlan(mockInput()), "opencode-foo")
    const outcome = verify(foo, {
      entries: [entry(GLOBAL, "opencode-foo@1.3.0"), entry(PROJECT_ROOT, "opencode-foo@1.1.0")],
      dirs: [],
    })
    expect(outcome.problems).toEqual(["/work/app/opencode.json still says opencode-foo@1.1.0"])
    expect(outcome.fixes).toEqual([
      'edit /work/app/opencode.json: "opencode-foo@1.1.0" → "opencode-foo@1.3.0"',
    ])
  })

  test("a project command runs where the project is, quoted when it has to be", () => {
    expect(commandLine({ cwd: "/work/my app", args: ["plugin", "x@1.0.0", "-f"] }, false)).toBe(
      "cd '/work/my app' && opencode plugin x@1.0.0 -f",
    )
  })
})
