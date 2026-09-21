import { afterEach, describe, expect, test } from "bun:test"
import { splitMatches } from "../src/tui/lib/search.ts"
import {
  cacheDirFor,
  fetchLatestVersion,
  isNewer,
  pinnedVersion,
  shouldCheck,
} from "../src/tui/lib/update.ts"

describe("update notice", () => {
  test("checks at most once a day", () => {
    const now = 1_000_000_000
    expect(shouldCheck(undefined, now)).toBe(true)
    expect(shouldCheck(now - 60_000, now)).toBe(false)
    expect(shouldCheck(now - 25 * 60 * 60 * 1000, now)).toBe(true)
  })

  test("only a higher release counts as newer", () => {
    expect(isNewer("0.1.6", "0.1.5")).toBe(true)
    expect(isNewer("0.2.0", "0.1.9")).toBe(true)
    expect(isNewer("1.0.0", "0.9.9")).toBe(true)
    expect(isNewer("0.1.5", "0.1.5")).toBe(false)
    expect(isNewer("0.1.4", "0.1.5")).toBe(false)
    expect(isNewer("0.2.0-beta.1", "0.1.9")).toBe(true)
    expect(isNewer("0.1.5-beta.1", "0.1.5")).toBe(false)
    expect(isNewer("0.1.5", "0.1.5-beta.1")).toBe(true)
    expect(isNewer("garbage", "0.1.5")).toBe(false)
  })

  test("the cache entry is the folder holding node_modules, and only for npm installs", () => {
    const target =
      "/Users/me/.cache/opencode/packages/@opencode-cockpit/shell@latest/node_modules/@opencode-cockpit/shell"
    expect(cacheDirFor(target, "npm")).toBe(
      "/Users/me/.cache/opencode/packages/@opencode-cockpit/shell@latest",
    )
    expect(cacheDirFor(target, "file")).toBeUndefined()
    expect(cacheDirFor("/repo/packages/shell", "npm")).toBeUndefined()
    expect(cacheDirFor(undefined, "npm")).toBeUndefined()
  })
})

describe("log search highlighting", () => {
  test("splits a line into plain and matching parts, ignoring case", () => {
    expect(splitMatches("FAIL src/auth.test.ts", "fail")).toEqual([
      { text: "FAIL", match: true },
      { text: " src/auth.test.ts", match: false },
    ])
    expect(splitMatches("a-b-a", "a")).toEqual([
      { text: "a", match: true },
      { text: "-b-", match: false },
      { text: "a", match: true },
    ])
    expect(splitMatches("nothing here", "zzz")).toEqual([{ text: "nothing here", match: false }])
    expect(splitMatches("plain", "")).toEqual([{ text: "plain", match: false }])
  })
})

/**
 * The registry check runs unasked, in the background, on someone else's network. Every way it can
 * go wrong has to end in "no answer" — never a thrown error, and never a toast about npm.
 */
describe("asking the registry", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const stub = (fn: (url: string, init: RequestInit) => Promise<Response> | Response) => {
    globalThis.fetch = ((url: string, init: RequestInit) => fn(String(url), init)) as typeof fetch
  }

  test("returns the published version", async () => {
    let seen = ""
    stub((url, init) => {
      seen = url
      expect((init.headers as Record<string, string>).accept).toContain("npm.install")
      return Response.json({ version: "1.4.0" })
    })
    expect(await fetchLatestVersion("opencode-cockpit")).toBe("1.4.0")
    expect(seen).toBe("https://registry.npmjs.org/opencode-cockpit/latest")
  })

  test("a private registry or a 404 is silence, not an error", async () => {
    stub(() => new Response("nope", { status: 404 }))
    expect(await fetchLatestVersion("opencode-cockpit")).toBeUndefined()
  })

  test("being offline is silence too", async () => {
    stub(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")))
    expect(await fetchLatestVersion("opencode-cockpit")).toBeUndefined()
  })

  test("a body without a version yields nothing to announce", async () => {
    stub(() => Response.json({}))
    expect(await fetchLatestVersion("opencode-cockpit")).toBeUndefined()
  })

  test("a registry that never answers gives up on its own", async () => {
    stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("timeout")))
        }),
    )
    expect(await fetchLatestVersion("opencode-cockpit", 20)).toBeUndefined()
  })
})

const NAME = "opencode-cockpit"

/**
 * The update clears a cache entry so the next start reinstalls. Against a pinned spec that
 * reinstalls the same version, so knowing a pin is there is the difference between updating and
 * saying you did.
 */
describe("finding a pin", () => {
  test("a bare name pins nothing", () => {
    expect(pinnedVersion([NAME], NAME)).toBeUndefined()
  })

  test("a version is a pin", () => {
    expect(pinnedVersion([`${NAME}@0.4.0`], NAME)).toBe("0.4.0")
  })

  test("a tag is not a pin — it moves on its own", () => {
    expect(pinnedVersion([`${NAME}@latest`], NAME)).toBeUndefined()
    expect(pinnedVersion([`${NAME}@next`], NAME)).toBeUndefined()
  })

  test("a path install pins nothing, whatever it looks like", () => {
    expect(pinnedVersion(["/Users/me/code/opencode-cockpit/packages/opencode"], NAME)).toBeUndefined()
    expect(pinnedVersion(["./local/plugin@0.1.0"], NAME)).toBeUndefined()
    expect(pinnedVersion(["file:../cockpit@0.1.0"], NAME)).toBeUndefined()
  })

  test("a scoped name keeps its own @", () => {
    expect(pinnedVersion(["@opencode-cockpit/shell@1.2.3"], "@opencode-cockpit/shell")).toBe("1.2.3")
    expect(pinnedVersion(["@opencode-cockpit/shell"], "@opencode-cockpit/shell")).toBeUndefined()
  })

  test("an entry paired with options is read the same way", () => {
    expect(pinnedVersion([[`${NAME}@2.0.0`, { ui: {} }]], NAME)).toBe("2.0.0")
  })

  test("another plugin's pin is not ours", () => {
    expect(pinnedVersion(["some-other-plugin@9.9.9", NAME], NAME)).toBeUndefined()
  })

  test("a prerelease still pins", () => {
    expect(pinnedVersion([`${NAME}@1.0.0-rc.1`], NAME)).toBe("1.0.0-rc.1")
  })
})
