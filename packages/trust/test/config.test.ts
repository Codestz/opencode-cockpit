import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  asTrustConfig,
  DEFAULTS,
  loadTrustConfig,
  resolveSettings,
  trustSection,
} from "../src/core/config.ts"
import { projectSlug, trustPaths } from "../src/core/paths.ts"

describe("config", () => {
  test("files are read for their trust section only", () => {
    expect(trustSection({ threshold: 9 })).toEqual({})
    expect(trustSection({ trust: { threshold: 5, other: 1 } })).toEqual({ threshold: 5 })
  })

  test("plugin options may be the section or a whole cockpit config", () => {
    expect(asTrustConfig({ threshold: 4 })).toEqual({ threshold: 4 })
    expect(asTrustConfig({ trust: { dangerExtra: 2 } })).toEqual({ dangerExtra: 2 })
  })

  test("global, then project, then options", async () => {
    const home = mkdtempSync(join(tmpdir(), "trust-config-"))
    const project = join(home, "project")
    mkdirSync(join(home, "xdg", "opencode-cockpit"), { recursive: true })
    mkdirSync(project)
    writeFileSync(
      join(home, "xdg", "opencode-cockpit", "config.json"),
      JSON.stringify({ trust: { threshold: 5, expireDays: 7 } }),
    )
    writeFileSync(join(project, ".cockpit.json"), JSON.stringify({ trust: { threshold: 4 } }))
    const config = await loadTrustConfig(project, { dangerExtra: 1 }, { XDG_CONFIG_HOME: join(home, "xdg") })
    expect(config).toEqual({ threshold: 4, expireDays: 7, dangerExtra: 1 })
  })

  test("a broken file costs nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "trust-config-"))
    writeFileSync(join(home, ".cockpit.json"), "{ nope")
    expect(await loadTrustConfig(home, undefined, { XDG_CONFIG_HOME: join(home, "none") })).toEqual({})
  })

  test("settings are made sensible: a threshold of 0 would trust anything", () => {
    expect(resolveSettings({})).toEqual(DEFAULTS)
    expect(resolveSettings({ threshold: 0, dangerExtra: -2, expireDays: 2.7 })).toMatchObject({
      threshold: 1,
      dangerExtra: 0,
      expireDays: 2,
    })
    expect(resolveSettings({ enabled: false }).enabled).toBe(false)
  })
})

describe("paths", () => {
  test("outside the project, readable, and certain", () => {
    const a = trustPaths("/Users/me/a/web", { HOME: "/home" })
    const b = trustPaths("/Users/me/b/web", { HOME: "/home" })
    expect(a.dir.startsWith("/home/.local/share/opencode-cockpit/trust/a-web-")).toBe(true)
    expect(a.events.endsWith("/events.ndjson")).toBe(true)
    expect(b.dir).not.toBe(a.dir.replace("/a-web-", "/b-web-"))
    expect(trustPaths("/x/y", { COCKPIT_HOME: "/c" }).dir.startsWith("/c/trust/x-y-")).toBe(true)
    expect(trustPaths("/x/y", { XDG_DATA_HOME: "/d" }).dir.startsWith("/d/opencode-cockpit/trust/")).toBe(
      true,
    )
  })

  test("a path cannot walk out", () => {
    expect(projectSlug("/../../etc")).toBe("etc")
  })
})
