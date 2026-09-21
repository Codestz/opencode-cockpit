/**
 * The registry check runs unasked, in the background, on someone else's network. Every way it can
 * go wrong has to end in "no answer" — never a thrown error. Ported from Shell's update notice,
 * whose stub asserted the `Accept` header npm now refuses: a stub checks what is sent, never what the
 * registry takes, so the header itself is pinned in e2e-findings.test.ts against what npm did.
 */

import { describe, expect, test } from "bun:test"
import { memoryDisk } from "../src/core/disk.ts"
import { fetchAllLatest, fetchLatest, registryFrom } from "../src/core/registry.ts"
import { updateCheckEnabled } from "../src/core/settings.ts"

const stub = (fn: (url: string, init: RequestInit) => Promise<Response> | Response) =>
  ((url: string, init: RequestInit) => fn(String(url), init)) as unknown as typeof fetch

describe("asking the registry", () => {
  test("a private registry or a 404 is silence, not an error", async () => {
    expect(
      await fetchLatest("x", { fetch: stub(() => new Response("nope", { status: 404 })) }),
    ).toBeUndefined()
  })

  test("being offline is silence too", async () => {
    const offline = stub(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")))
    expect(await fetchLatest("x", { fetch: offline })).toBeUndefined()
  })

  test("a body without a version yields nothing", async () => {
    expect(await fetchLatest("x", { fetch: stub(() => Response.json({})) })).toBeUndefined()
  })

  test("a registry that never answers gives up on its own", async () => {
    const hang = stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("timeout")))
        }),
    )
    expect(await fetchLatest("x", { fetch: hang, timeoutMs: 20 })).toBeUndefined()
  })

  test("one failure does not sink the others", async () => {
    const mixed = stub((url) =>
      url.includes("/bad/") ? new Response("", { status: 500 }) : Response.json({ version: "1.0.0" }),
    )
    const all = await fetchAllLatest(["good", "bad"], { fetch: mixed })
    expect([...all]).toEqual([
      ["good", "1.0.0"],
      ["bad", undefined],
    ])
  })
})

describe("the daily notice setting", () => {
  const where = { env: {}, home: "/home/me", directory: "/work/app" }
  const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"

  test("on unless something says otherwise", () => {
    expect(updateCheckEnabled(memoryDisk({}), where, undefined)).toBe(true)
  })

  test("Shell's old `ui.updateCheck: false` still silences it", () => {
    expect(
      updateCheckEnabled(memoryDisk({ [GLOBAL]: '{"ui":{"updateCheck":false}}' }), where, undefined),
    ).toBe(false)
  })

  test("the project file beats the global one, and plugin options beat both", () => {
    const disk = memoryDisk({
      [GLOBAL]: '{"updater":{"updateCheck":false}}',
      "/work/app/.cockpit.json": '{"updater":{"updateCheck":true}}',
    })
    expect(updateCheckEnabled(disk, where, undefined)).toBe(true)
    expect(updateCheckEnabled(disk, where, { updateCheck: false })).toBe(false)
  })

  test("a broken config file is ignored, not fatal", () => {
    expect(updateCheckEnabled(memoryDisk({ [GLOBAL]: "{" }), where, undefined)).toBe(true)
  })
})

describe("which registry", () => {
  test("the one npm would use, so a private plugin is asked where it lives", () => {
    expect(registryFrom({})).toBe("https://registry.npmjs.org")
    expect(registryFrom({ npm_config_registry: "http://localhost:4873/" })).toBe("http://localhost:4873/")
    expect(registryFrom({ NPM_CONFIG_REGISTRY: "https://npm.corp" })).toBe("https://npm.corp")
  })

  test("a registry with a trailing slash still gets one slash", async () => {
    const seen: string[] = []
    const fake = (async (url: string) => {
      seen.push(url)
      return Response.json({ version: "1.0.0" })
    }) as unknown as typeof fetch
    await fetchLatest("x", { registry: "http://localhost:4873/", fetch: fake })
    expect(seen).toEqual(["http://localhost:4873/x/latest"])
  })
})
