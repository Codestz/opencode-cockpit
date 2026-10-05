import { describe, expect, test } from "bun:test"
import { composeParts, dualServer, type ServerParts } from "../src/opencode/server.ts"
import { keyText, openText, registerSurfaces, surfacesLine } from "../src/opencode/surfaces.ts"
import { DEFAULT_KEYS } from "../src/settings/catalog.ts"

/**
 * The one Cockpit-wide line: where the user sees what the agent made, written from the bays that are
 * loaded, said once per window and only to the main agent.
 */

const shells = { what: "your background shells", open: "ctrl+x o" }
const subagents = { what: "subagents", open: "ctrl+x d" }
const trail = { what: "this conversation's trail", open: "ctrl+x f" }
const review = { what: "review threads", where: "Review", open: "ctrl+x v" }

describe("the line", () => {
  test("names the sidebar's bays together, then each other place", () => {
    expect(surfacesLine([shells, review, subagents, trail])).toBe(
      "The user sees your background shells (ctrl+x o), subagents (ctrl+x d) and this conversation's trail (ctrl+x f) in the sidebar, and review threads in Review (ctrl+x v): point them there instead of pasting those lists.",
    )
  })

  test("one bay alone, and none at all", () => {
    expect(surfacesLine([review])).toBe(
      "The user sees review threads in Review (ctrl+x v): point them there instead of pasting those lists.",
    )
    expect(surfacesLine([])).toBeUndefined()
  })
})

describe("keys as the user presses them", () => {
  test("<leader> is OpenCode's ctrl+x; the first of several; none is no key", () => {
    expect(keyText("<leader>v")).toBe("ctrl+x v")
    expect(keyText("ctrl+o,<leader>o")).toBe("ctrl+o")
    expect(keyText("none")).toBeUndefined()
    expect(keyText(undefined)).toBeUndefined()
  })

  test("the bay's default unless the settings change it; its slash command when the key is off", () => {
    expect(DEFAULT_KEYS.review?.["cockpit.review.open"]).toBe("<leader>v")
    expect(openText("review", "cockpit.review.open", {}, "changes")).toBe("ctrl+x v")
    expect(openText("review", "cockpit.review.open", { "cockpit.review.open": "<leader>g" }, "changes")).toBe(
      "ctrl+x g",
    )
    expect(openText("review", "cockpit.review.open", { "cockpit.review.open": "none" }, "changes")).toBe(
      "/changes",
    )
  })
})

describe("once per window", () => {
  test("the first entry still registered says every entry's fragments; the others say nothing", () => {
    const scope = {}
    const a = registerSurfaces(scope, [shells])
    const b = registerSurfaces(scope, [review])
    expect(a.line()).toBe(surfacesLine([shells, review]))
    expect(b.line()).toBeUndefined()
    a.release()
    expect(b.line()).toBe(surfacesLine([review]))
    expect(registerSurfaces({}, [trail]).line()).toBe(surfacesLine([trail]))
  })

  test("the bundle composes its bays' fragments into one entry", () => {
    expect(composeParts([{ surfaces: [shells] }, {}, { surfaces: [review] }]).surfaces).toEqual([
      shells,
      review,
    ])
  })
})

/** A v2 context the way OpenCode 2 hands one to `setup`: enough for tools, the context hook and sessions. */
function fakeV2(parents: Record<string, string> = {}) {
  let context: ((event: { sessionID: string; system: unknown[] }) => unknown) | undefined
  const ctx = {
    options: {},
    location: { directory: `/work/surfaces-${crypto.randomUUID()}` },
    tool: { transform: async () => {} },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, parentID: parents[sessionID] }),
      hook: async (_name: string, run: typeof context) => {
        context = run
      },
    },
    event: { subscribe: async function* () {} },
  }
  const say = async (sessionID: string) => {
    const event = { sessionID, system: [] as { text: string }[] }
    await context?.(event)
    return event.system.map((part) => part.text)
  }
  return { ctx, say }
}

describe("through the entries OpenCode loads", () => {
  const bay = (parts: ServerParts) => async () => parts

  test("two bays installed apart: the line comes once, ahead of the first one's guidance", async () => {
    const one = fakeV2({ ses_child: "ses_main" })
    const shell = dualServer("cockpit.shell", bay({ surfaces: [shells], system: async () => ["## Shells"] }))
    const rev = dualServer("cockpit.review", bay({ surfaces: [review], system: async () => ["## Review"] }))
    const stop = await shell.setup(one.ctx as never)
    /** OpenCode 2 hands every plugin of a location its own context; the scope is shared by directory. */
    const other = { ...one.ctx, session: { ...one.ctx.session, hook: async () => {} } }
    await rev.setup(other as never)
    expect(await one.say("ses_main")).toEqual([surfacesLine([shells, review]), "## Shells"])
    /** A subagent answers its caller, not the user: no line for it. */
    expect(await one.say("ses_child")).toEqual(["## Shells"])
    await stop?.()
  })

  test("a bay that shows nothing adds no line", async () => {
    const one = fakeV2()
    const entry = dualServer("cockpit.plain", bay({ system: async () => ["## Plain"] }))
    const stop = await entry.setup(one.ctx as never)
    expect(await one.say("ses_main")).toEqual(["## Plain"])
    await stop?.()
  })
})
