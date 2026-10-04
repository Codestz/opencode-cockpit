import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FileChange } from "../../src/core/model/review.ts"
import { createViewer, type Launched, oldName, type ViewerDeps } from "../../src/core/viewer.ts"

/**
 * `o`, with the system stubbed out: nothing here ever launches a real viewer. The opener is "found"
 * by a fake `which`, "launched" by a fake `spawn` that records what it was asked to open.
 */

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const OLD = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

const setup = (overrides: Partial<ViewerDeps> = {}) => {
  const tmp = mkdtempSync(join(tmpdir(), "ck-viewer-test-"))
  roots.push(tmp)
  const launched: { command: string; args: string[]; env: Record<string, string | undefined> }[] = []
  const listeners: ((error: Error) => void)[] = []
  const reported: string[] = []
  const looked: { command: string; PATH: string }[] = []
  const deps: ViewerDeps = {
    platform: "darwin",
    env: { PATH: "/shim:/usr/bin", HOME: "/home/x" },
    which: (command, options) => {
      looked.push({ command, PATH: options.PATH })
      return `/shim/${command}`
    },
    /** No `/usr/bin/open` on this fake machine: the opener comes off the PATH. */
    exists: () => false,
    spawn: (command, args, env): Launched => {
      launched.push({ command, args, env })
      return {
        on: (_event, listener) => listeners.push(listener),
        unref: () => {},
      }
    },
    readOld: async () => OLD,
    tmp,
    report: (problem) => reported.push(problem),
    ...overrides,
  }
  return { viewer: createViewer(deps), launched, listeners, reported, looked, tmp }
}

const file = (binary: FileChange["binary"], path = "media/shot.png"): FileChange => ({
  path,
  before: "",
  after: "",
  additions: 0,
  deletions: 0,
  ...(binary ? { binary } : {}),
})
const both = file({
  before: { size: 7 },
  after: { size: 9 },
  revision: "0123456789abcdef0123456789abcdef01234567",
})

describe("o opens both versions", () => {
  test("the old one from git into a named temp file, the new one where it is", async () => {
    const { viewer, launched, tmp } = setup()
    const result = await viewer.open("/repo", both)
    expect(result).toEqual({ opened: 2 })
    expect(launched.map((each) => each.command)).toEqual(["/shim/open", "/shim/open"])
    const [old, now] = launched.map((each) => each.args.at(-1) as string)
    expect(old?.startsWith(tmp)).toBe(true)
    expect(old?.endsWith("shot@0123456.png")).toBe(true)
    expect(new Uint8Array(readFileSync(old as string))).toEqual(OLD)
    expect(now).toBe("/repo/media/shot.png")
  })

  test("the opener is found on the PATH the spawn is given, not the parent's", async () => {
    const { viewer, looked, launched } = setup()
    await viewer.open("/repo", both)
    expect(looked[0]).toEqual({ command: "open", PATH: "/shim:/usr/bin" })
    expect(launched[0]?.env.PATH).toBe("/shim:/usr/bin")
  })

  test("an added file has only its new side, a deleted one only its old", async () => {
    const added = setup()
    await added.viewer.open("/repo", file({ after: { size: 9 } }))
    expect(added.launched.map((each) => each.args.at(-1))).toEqual(["/repo/media/shot.png"])
    const deleted = setup()
    await deleted.viewer.open("/repo", file({ before: { size: 7 }, revision: "HEAD" }))
    expect(deleted.launched.map((each) => each.args.at(-1)?.endsWith("shot@HEAD.png"))).toEqual([true])
  })

  test("no opener on this system: said, nothing launched", async () => {
    const { viewer, launched } = setup({ platform: "linux", which: () => null })
    const result = await viewer.open("/repo", both)
    expect(result.opened).toBe(0)
    expect(result.problem).toContain("xdg-open is not on PATH")
    expect(launched).toEqual([])
  })

  test("the old side unreadable: said, nothing launched", async () => {
    const { viewer, launched } = setup({ readOld: async () => undefined })
    const result = await viewer.open("/repo", both)
    expect(result.problem).toContain("Could not read the old shot.png")
    expect(launched).toEqual([])
  })

  test("an opener that fails to start is reported, not swallowed", async () => {
    const { viewer, listeners, reported } = setup()
    await viewer.open("/repo", both)
    expect(listeners).toHaveLength(2)
    listeners[1]?.(new Error("spawn EACCES"))
    expect(reported).toEqual(["Could not open shot.png: spawn EACCES"])
  })

  test("closing the pane removes its temp copies", async () => {
    const { viewer, launched } = setup()
    await viewer.open("/repo", both)
    const old = launched[0]?.args.at(-1) as string
    expect(existsSync(old)).toBe(true)
    await viewer.clean()
    expect(existsSync(old)).toBe(false)
  })

  test("a crashed pane's leftovers are swept on the next open — only old ones", async () => {
    const { viewer, tmp } = setup()
    const stale = join(tmp, "cockpit-review-stale")
    const live = join(tmp, "cockpit-review-live")
    mkdirSync(stale)
    mkdirSync(live)
    const day = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(stale, day, day)
    await viewer.open("/repo", both)
    const left = readdirSync(tmp)
    expect(left).not.toContain("cockpit-review-stale")
    expect(left).toContain("cockpit-review-live")
  })
})

describe("the opener for each platform (client's openerFor has the rest)", () => {
  test("open, xdg-open, start", async () => {
    const opened = async (platform: NodeJS.Platform) => {
      const { viewer, launched } = setup({ platform })
      await viewer.open("/repo", file({ after: { size: 1 } }))
      return launched.map(({ command, args }) => [command, ...args])
    }
    expect(await opened("darwin")).toEqual([["/shim/open", "/repo/media/shot.png"]])
    expect(await opened("linux")).toEqual([["/shim/xdg-open", "/repo/media/shot.png"]])
    expect(await opened("win32")).toEqual([["/shim/cmd", "/c", "start", "", "/repo/media/shot.png"]])
  })

  test("macOS's /usr/bin/open before PATH, and COCKPIT_OPENER over both", async () => {
    const system = setup({ exists: (path) => path === "/usr/bin/open" })
    await system.viewer.open("/repo", file({ after: { size: 1 } }))
    expect(system.launched[0]?.command).toBe("/usr/bin/open")
    const stub = setup({ env: { PATH: "/shim", COCKPIT_OPENER: "/tmp/stub" } })
    await stub.viewer.open("/repo", file({ after: { size: 1 } }))
    expect(stub.launched[0]).toMatchObject({ command: "/tmp/stub", args: ["/repo/media/shot.png"] })
  })

  test("the temp name keeps the extension and says which side", () => {
    expect(oldName({ ...both, from: "img/old-name.gif" })).toBe("old-name@0123456.gif")
    expect(oldName(file({ before: { size: 1 }, revision: "HEAD" }, "Makefile"))).toBe("Makefile@HEAD")
  })
})
