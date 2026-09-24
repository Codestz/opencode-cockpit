import { describe, expect, test } from "bun:test"
import { memoryDisk } from "../src/core/disk.ts"
import type { Check } from "../src/doctor/checks.ts"
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
}

async function run(machine: Machine, args: string[] = []) {
  let out = ""
  const files = machine.files ?? {}
  const io: DoctorIo & { write(text: string): void; color: boolean } = {
    env: {},
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
          statusline: { modules: ["~/.config/opencode-cockpit/modules/gone.ts"] },
        }),
      },
    })
    expect(found.Settings?.state).toBe("warn")
    expect(found.Settings?.fix?.join()).toContain("gone.ts")
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
