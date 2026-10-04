import { describe, expect, test } from "bun:test"
import { openerFor, openerName, systemOpenerWhere } from "../src/opener.ts"

/** The argv each platform gets, decided without running anything: `have` is what this fake machine has. */
const where = (platform: string, have: string[] = []) => ({
  platform,
  exists: (path: string) => have.includes(path),
  which: (name: string) => (have.includes(name) ? `/somewhere/${name}` : undefined),
})

describe("the opener for each platform (Trail's links, Review's images)", () => {
  const url = "https://github.com/a/b/pull/1"

  test("macOS: /usr/bin/open first, then PATH, else none", () => {
    expect(openerFor(url, where("darwin", ["/usr/bin/open", "open"]))).toEqual({
      command: "/usr/bin/open",
      args: [url],
    })
    expect(openerFor(url, where("darwin", ["open"]))).toEqual({ command: "/somewhere/open", args: [url] })
    expect(openerFor(url, where("darwin"))).toBeUndefined()
  })

  test("Linux: xdg-open from PATH, else none", () => {
    expect(openerFor("/repo/shot.png", where("linux", ["xdg-open"]))).toEqual({
      command: "/somewhere/xdg-open",
      args: ["/repo/shot.png"],
    })
    expect(openerFor(url, where("linux"))).toBeUndefined()
  })

  test("Windows: start through cmd, an empty title first, & kept from cmd where Node leaves it unquoted", () => {
    expect(openerFor("https://a.dev/?a=1&b=2", where("win32", ["cmd"]))).toEqual({
      command: "/somewhere/cmd",
      args: ["/c", "start", "", "https://a.dev/?a=1^&b=2"],
    })
    /** Quoted by Node for its space, where `^` would be read as itself. */
    expect(openerFor("C:\\my shots\\a&b.png", where("win32"))).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "C:\\my shots\\a&b.png"],
    })
  })

  test("COCKPIT_OPENER wins on every platform", () => {
    for (const platform of ["darwin", "linux", "win32"])
      expect(openerFor(url, { ...where(platform, ["/usr/bin/open"]), override: "/tmp/stub" })).toEqual({
        command: "/tmp/stub",
        args: [url],
      })
  })

  test("the program's name, for saying it is missing", () => {
    expect(["darwin", "linux", "win32"].map(openerName)).toEqual(["open", "xdg-open", "cmd"])
  })

  test("this machine: programs from the PATH it is given, the override from the env", () => {
    const empty = systemOpenerWhere({ PATH: "" }, "linux")
    expect(empty.which("sh")).toBeUndefined()
    expect(empty.override).toBeUndefined()
    expect(systemOpenerWhere({ PATH: "/usr/bin:/bin" }, "linux").which("sh")).toEndWith("/sh")
    expect(systemOpenerWhere({ PATH: "", COCKPIT_OPENER: "/tmp/stub" }).override).toBe("/tmp/stub")
  })
})
