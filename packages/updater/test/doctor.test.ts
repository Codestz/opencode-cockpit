import { describe, expect, test } from "bun:test"
import { memoryDisk } from "../src/core/disk.ts"
import { ago, type Check } from "../src/doctor/checks.ts"
import type { DoctorIo } from "../src/doctor/gather.ts"
import { doctor } from "../src/doctor/run.ts"

/**
 * Doctor against machines made of objects — each one a setup someone actually had, or one this
 * week's work ran into — and what it says about them. What matters is the verdict and the fix line:
 * a doctor that says "something is wrong" without the next step is the silence it exists to end.
 */

const HOME = "/home/me"
const CONFIG = `${HOME}/.config/opencode`

interface Machine {
  opencode?: string
  files?: Record<string, string>
  latest?: Record<string, string>
  /** Paths that exist beyond the files: package directories, OpenTUI in a checkout. */
  exists?: string[]
  alive?: number[]
  git?: boolean
  env?: Record<string, string>
}

async function run(machine: Machine, args: string[] = []) {
  let out = ""
  const files = machine.files ?? {}
  const io: DoctorIo & { write(text: string): void; color: boolean } = {
    env: machine.env ?? {},
    home: HOME,
    cwd: "/work/project",
    worktree: "/work/project",
    disk: memoryDisk(files),
    exists: (path) => path in files || (machine.exists ?? []).includes(path),
    run(command) {
      if (command === "opencode")
        return machine.opencode ? { status: 0, stdout: `${machine.opencode}\n` } : undefined
      if (command === "git") return machine.git === false ? undefined : { status: 0, stdout: "git version 2" }
      return { status: 0, stdout: "" }
    },
    alive: (pid) => (machine.alive ?? []).includes(pid),
    writable: () => true,
    fetchLatest: async (names) => new Map(names.map((name) => [name, machine.latest?.[name]])),
    now: Date.parse("2026-09-24T12:00:00Z"),
    write: (text) => {
      out += text
    },
    color: false,
  }
  const code = await doctor(["doctor", ...args], io)
  return { code, out }
}

async function checks(machine: Machine): Promise<Record<string, Check>> {
  const { out } = await run(machine, ["--json"])
  const parsed = JSON.parse(out) as { checks: Check[] }
  return Object.fromEntries(parsed.checks.map((check) => [check.title, check]))
}

const json = (value: unknown) => JSON.stringify(value)

describe("OpenCode itself", () => {
  test("missing is the first thing to fix", async () => {
    const found = await checks({})
    expect(found.OpenCode?.state).toBe("fail")
  })

  test("1.17 is older than Cockpit supports, and says what does", async () => {
    const found = await checks({ opencode: "1.17.20" })
    expect(found.OpenCode?.state).toBe("fail")
    expect(found.OpenCode?.detail?.join()).toContain("1.18")
  })

  test("1.18 and 2 are both fine", async () => {
    expect((await checks({ opencode: "1.18.0" })).OpenCode?.state).toBe("ok")
    expect((await checks({ opencode: "opencode v2.0.15" })).OpenCode?.state).toBe("ok")
  })
})

describe("the config", () => {
  test("nothing configured: the install line for the OpenCode installed", async () => {
    const v1 = await checks({ opencode: "1.18.32", latest: { "opencode-cockpit": "0.6.0" } })
    expect(v1.Config?.state).toBe("fail")
    expect(v1.Config?.fix).toEqual(["opencode plugin opencode-cockpit@0.6.0 --global --force"])
    const v2 = await checks({ opencode: "2.0.15", latest: { "opencode-cockpit": "0.6.0" } })
    expect(v2.Config?.fix).toEqual(["opencode plugin add opencode-cockpit@0.6.0"])
  })

  test("v2's spelling is read: an object entry under `plugins`", async () => {
    const found = await checks({
      opencode: "2.0.15",
      latest: { "opencode-cockpit": "0.6.0" },
      files: {
        [`${CONFIG}/opencode.json`]: json({ plugins: [{ package: "opencode-cockpit@0.6.0", options: {} }] }),
      },
    })
    expect(found.Config?.state).toBe("ok")
  })

  test("on OpenCode 2, a pin older than 0.6 cannot load, and the fix edits the entry", async () => {
    const found = await checks({
      opencode: "2.0.15",
      latest: { "opencode-cockpit": "0.6.0" },
      files: { [`${CONFIG}/opencode.json`]: json({ plugin: ["opencode-cockpit@0.5.2"] }) },
    })
    expect(found.Config?.state).toBe("fail")
    expect(found.Config?.fix?.join()).toContain('change the entry to "opencode-cockpit@0.6.0"')
  })

  test("on OpenCode 1, a newer release is a warning with the updater's line", async () => {
    const found = await checks({
      opencode: "1.18.32",
      latest: { "opencode-cockpit": "0.6.0" },
      files: {
        [`${CONFIG}/opencode.json`]: json({ plugin: ["opencode-cockpit@0.5.2"] }),
        [`${CONFIG}/tui.json`]: json({ plugin: ["opencode-cockpit@0.5.2"] }),
      },
    })
    expect(found.Config?.state).toBe("warn")
    expect(found.Config?.fix?.join()).toContain("npx opencode-cockpit@latest update")
  })

  test("on OpenCode 1, one half missing: panels or tools that never appear", async () => {
    const found = await checks({
      opencode: "1.18.32",
      latest: { "opencode-cockpit": "0.6.0" },
      files: { [`${CONFIG}/opencode.json`]: json({ plugin: ["opencode-cockpit@0.6.0"] }) },
    })
    expect(found.Config?.state).toBe("warn")
    expect(found.Config?.fix?.join()).toContain("not tui.json")
  })

  test("the bundle and a bay of it, both configured: one stands down", async () => {
    const found = await checks({
      opencode: "2.0.15",
      latest: { "opencode-cockpit": "0.6.0", "@opencode-cockpit/shell": "0.6.0" },
      files: {
        [`${CONFIG}/opencode.json`]: json({
          plugins: ["opencode-cockpit@0.6.0", "@opencode-cockpit/shell@0.6.0"],
        }),
      },
    })
    expect(found.Config?.state).toBe("warn")
    expect(found.Config?.fix?.join()).toContain("also inside opencode-cockpit")
  })

  /** v1 never reads cli.json: panels configured only there do not show. */
  test("on OpenCode 1, the interface configured only in cli.json is a missing half", async () => {
    const found = await checks({
      opencode: "1.18.32",
      latest: { "opencode-cockpit": "0.6.0" },
      files: {
        [`${CONFIG}/opencode.json`]: json({ plugin: ["opencode-cockpit@0.6.0"] }),
        [`${CONFIG}/cli.json`]: json({ plugins: ["opencode-cockpit@0.6.0"] }),
      },
    })
    expect(found.Config?.state).toBe("warn")
    expect(found.Config?.fix?.join()).toContain("not tui.json")
    expect(found.Config?.detail?.join()).toContain("not read by OpenCode 1")
  })

  /** v2 loads the interface from opencode.json too, so the bundle there and a bay in cli.json clash. */
  test("on OpenCode 2, the bundle in opencode.json and a bay in cli.json is the bay twice", async () => {
    const found = await checks({
      opencode: "2.0.15",
      latest: { "opencode-cockpit": "0.6.0", "@opencode-cockpit/shell": "0.6.0" },
      files: {
        [`${CONFIG}/opencode.json`]: json({ plugins: ["opencode-cockpit@0.6.0"] }),
        [`${CONFIG}/cli.json`]: json({ plugins: ["@opencode-cockpit/shell@0.6.0"] }),
      },
    })
    expect(found.Config?.state).toBe("warn")
    expect(found.Config?.fix?.join()).toContain("also inside opencode-cockpit")
  })

  test("the same package in opencode.json and cli.json on OpenCode 2 is fine: it loads once", async () => {
    const found = await checks({
      opencode: "2.0.15",
      latest: { "opencode-cockpit": "0.6.0" },
      files: {
        [`${CONFIG}/opencode.json`]: json({ plugins: ["opencode-cockpit@0.6.0"] }),
        [`${CONFIG}/cli.json`]: json({ plugins: ["opencode-cockpit@0.6.0"] }),
      },
    })
    expect(found.Config?.state).toBe("ok")
  })

  test("OpenCode 2 pointed at a checkout: the OPENTUI_FORCE_WCWIDTH failure, before it happens", async () => {
    const repo = "/src/opencode-cockpit"
    const found = await checks({
      opencode: "2.0.15",
      files: {
        [`${CONFIG}/opencode.json`]: json({ plugins: [`${repo}/packages/opencode`] }),
        [`${repo}/packages/opencode/package.json`]: json({ name: "opencode-cockpit" }),
      },
      exists: [`${repo}/packages/opencode/node_modules/@opentui/core`],
    })
    expect(found.Config?.state).toBe("fail")
    expect(found.Config?.fix?.join()).toContain("bun run dev:install")
  })

  test("an install by path is fine", async () => {
    const found = await checks({
      opencode: "2.0.15",
      files: {
        [`${CONFIG}/opencode.json`]: json({
          plugins: [`${HOME}/.cockpit-dev/node_modules/opencode-cockpit`],
        }),
        [`${HOME}/.cockpit-dev/node_modules/opencode-cockpit/package.json`]: json({
          name: "opencode-cockpit",
        }),
      },
    })
    expect(found.Config?.state).toBe("info")
  })

  test("a config that does not parse is named", async () => {
    const found = await checks({ opencode: "2.0.15", files: { [`${CONFIG}/opencode.json`]: "{ nope" } })
    expect(found.Config?.state).toBe("fail")
    expect(found.Config?.detail?.join()).toContain("opencode.json")
  })
})

describe("the logs", () => {
  const log = (...lines: object[]) => lines.map((line) => JSON.stringify(line)).join("\n")
  const LOG = `${HOME}/.cache/opencode-cockpit/cockpit.log`

  test("what actually ran, from the start lines", async () => {
    const found = await checks({
      opencode: "2.0.15",
      files: {
        [LOG]: log(
          {
            t: "2026-09-24T11:00:00Z",
            lvl: "info",
            scope: "tui",
            msg: "start",
            entry: "opencode-cockpit",
            opencode: 2,
            cockpit: "0.6.0",
          },
          {
            t: "2026-09-24T11:00:01Z",
            lvl: "info",
            scope: "server",
            msg: "start",
            entry: "opencode-cockpit",
            opencode: 2,
            cockpit: "0.6.0",
          },
        ),
      },
    })
    expect(found["Last run"]?.state).toBe("ok")
    expect(found["Last run"]?.summary).toContain("Cockpit 0.6.0 on OpenCode 2")
    // Just under an hour before doctor ran, said that way: not the raw ISO stamp from the log.
    expect(found["Last run"]?.summary).toMatch(/, 59m ago$/)
  })

  test("two versions loaded at once is worth saying", async () => {
    const found = await checks({
      opencode: "2.0.15",
      files: {
        [LOG]: log(
          {
            t: "2026-09-24T11:00:00Z",
            lvl: "info",
            scope: "tui",
            msg: "start",
            entry: "opencode-cockpit.shell",
            cockpit: "0.6.0",
          },
          {
            t: "2026-09-24T11:00:00Z",
            lvl: "info",
            scope: "tui",
            msg: "start",
            entry: "opencode-cockpit.review",
            cockpit: "0.5.9",
          },
        ),
      },
    })
    expect(found["Last run"]?.state).toBe("warn")
  })

  test("errors from the last day, with their messages; older ones are history", async () => {
    const found = await checks({
      opencode: "2.0.15",
      files: {
        [LOG]: log(
          { t: "2026-09-20T11:00:00Z", lvl: "error", scope: "tui:review", msg: "old" },
          {
            t: "2026-09-24T11:00:00Z",
            lvl: "error",
            scope: "tui:review",
            msg: "review: trouble",
            message: "ink.constructor.clone is not a function",
          },
        ),
      },
    })
    expect(found.Errors?.state).toBe("warn")
    expect(found.Errors?.summary).toStartWith("1 error")
    expect(found.Errors?.detail?.join()).toContain("ink.constructor.clone")
  })
})

describe("the rest", () => {
  test("a running daemon, by its pid", async () => {
    const found = await checks({
      opencode: "2.0.15",
      files: { [`${HOME}/.cache/opencode-cockpit/cockpitd.pid`]: "4242" },
      alive: [4242],
    })
    expect(found.Daemon?.state).toBe("ok")
  })

  test("no git is a failure with a reason", async () => {
    const found = await checks({ opencode: "2.0.15", git: false })
    expect(found.Environment?.state).toBe("fail")
  })

  test("a statusline module that is not there", async () => {
    const found = await checks({
      opencode: "2.0.15",
      files: {
        [`${HOME}/.config/opencode-cockpit/config.json`]: json({
          status: { modules: ["~/.config/opencode-cockpit/modules/gone.ts"] },
        }),
      },
    })
    expect(found.Settings?.state).toBe("warn")
    expect(found.Settings?.fix?.join()).toContain("gone.ts")
  })
})

/**
 * Doctor reads Cockpit's settings through the loader the bays use, so the two cannot disagree: a file
 * with a comment was "fine" to doctor while every bay dropped it whole.
 */
describe("Cockpit's settings", () => {
  const GLOBAL = `${HOME}/.config/opencode-cockpit/config.json`
  const PROJECT = "/work/project/.cockpit.json"

  test("comments and trailing commas: fine to doctor, and read by the bays", async () => {
    const files = { [GLOBAL]: `{\n  // mine\n  "trust": { "threshold": 5, },\n}` }
    const found = await checks({ opencode: "2.0.18", files })
    expect(found.Settings?.state).toBe("ok")
    expect(found.Settings?.summary).toBe("1 file")
    const { baySettings } = await import("@opencode-cockpit/client/settings")
    const trust = baySettings(
      "trust",
      { threshold: 3 },
      {
        where: {
          env: {},
          home: HOME,
          directory: "/work/project",
          read: (path) => memoryDisk(files).read(path),
        },
      },
    )
    expect(trust.config.threshold).toBe(5)
  })

  test("a file the bays cannot parse is not fine", async () => {
    const found = await checks({ opencode: "2.0.18", files: { [PROJECT]: `{ "trust": { "threshold": 5 ` } })
    expect(found.Settings?.state).toBe("warn")
    expect(found.Settings?.summary).toBe("a settings file Cockpit cannot use")
    expect(found.Settings?.fix?.[0]).toStartWith(`${PROJECT}: `)
    expect(found.Settings?.fix?.[0]).toEndWith("the whole file is ignored")
  })

  test("every old name and unknown sidebar entry is a fix line", async () => {
    const found = await checks({
      opencode: "2.0.18",
      files: {
        [GLOBAL]: json({
          statusline: { preset: "sidebar" },
          ui: { dockHeight: 20 },
          sidebar: ["shells", "status"],
        }),
        [PROJECT]: json({ trust: { sidebarOrder: 1 } }),
      },
    })
    expect(found.Settings?.state).toBe("warn")
    expect(found.Settings?.summary).toBe("settings that are not read as written")
    expect(found.Settings?.fix).toEqual([
      `${GLOBAL}: "statusline" is no longer read — run /cockpit-setup`,
      `${GLOBAL}: "ui.dockHeight" is no longer read — run /cockpit-setup`,
      `${GLOBAL}: "shells" in "sidebar" is not a bay: did you mean "shell"? (status, subagents, shell, trail, trust)`,
      `${PROJECT}: "trust.sidebarOrder" is no longer read — run /cockpit-setup`,
    ])
  })
})

describe("background subagents (the 0.8 load test)", () => {
  const bundle = { [`${CONFIG}/opencode.json`]: json({ plugin: ["opencode-cockpit@0.6.0"] }) }

  test("OpenCode 1 without its flag: a warning with the line that fixes it", async () => {
    const found = await checks({ opencode: "1.18.32", files: bundle })
    expect(found.Subagents?.state).toBe("warn")
    expect(found.Subagents?.fix?.join()).toContain("export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true")
  })

  test("the flag, or OpenCode's umbrella experimental one, turns it on", async () => {
    const own = await checks({
      opencode: "1.18.32",
      files: bundle,
      env: { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true" },
    })
    expect(own.Subagents?.state).toBe("ok")
    const umbrella = await checks({ opencode: "1.18.32", files: bundle, env: { OPENCODE_EXPERIMENTAL: "1" } })
    expect(umbrella.Subagents?.state).toBe("ok")
  })

  test("OpenCode 2 has them built in; without Subagents installed there is nothing to say", async () => {
    const v2 = await checks({
      opencode: "2.0.15",
      files: { [`${CONFIG}/opencode.json`]: json({ plugins: ["opencode-cockpit@0.6.0"] }) },
    })
    expect(v2.Subagents?.state).toBe("ok")
    expect((await checks({ opencode: "1.18.32" })).Subagents).toBeUndefined()
  })
})

describe("the command", () => {
  test("exits 1 when something must be fixed, 0 otherwise", async () => {
    expect((await run({})).code).toBe(1)
    const fine = await run({
      opencode: "2.0.15",
      latest: { "opencode-cockpit": "0.6.0" },
      files: { [`${CONFIG}/opencode.json`]: json({ plugins: ["opencode-cockpit@0.6.0"] }) },
    })
    expect(fine.code).toBe(0)
    expect(fine.out).toContain("Cockpit doctor")
  })

  test("an unknown argument is refused, with the help", async () => {
    const { code, out } = await run({}, ["--wat"])
    expect(code).toBe(2)
    expect(out).toContain("Usage:")
  })
})

describe("a logged time reads as how long ago", () => {
  const now = Date.parse("2026-09-30T12:00:00Z")
  test("by the largest unit that says it", () => {
    expect(ago("2026-09-30T11:59:30Z", now)).toBe("just now")
    expect(ago("2026-09-30T11:48:00Z", now)).toBe("12m ago")
    expect(ago("2026-09-30T05:00:00Z", now)).toBe("7h ago")
    expect(ago("2026-09-26T12:00:00Z", now)).toBe("4d ago")
  })
  test("a time it cannot read, or no clock, is printed as logged", () => {
    expect(ago("yesterday", now)).toBe("yesterday")
    expect(ago("2026-09-30T11:00:00Z", undefined)).toBe("2026-09-30T11:00:00Z")
  })
})
