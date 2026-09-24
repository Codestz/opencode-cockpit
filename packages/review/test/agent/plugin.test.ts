import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { partsToV1Hooks, serverFromV1 } from "@opencode-cockpit/client/server"
import { createReviewServer } from "../../src/agent/plugin.ts"
import type { Thread } from "../../src/core/model/thread.ts"
import { reviewPaths } from "../../src/core/store/paths.ts"
import { createPersistence } from "../../src/core/store/persist.ts"

/**
 * The server half's own behaviour: what it tells the agent before the agent asks anything.
 *
 * A system prompt is the one place a plugin can be wrong in silence — nobody sees it, and the only
 * symptom is an agent that does not do what it was supposed to. So what goes in it is tested.
 */

let home: string
let logged: string[]

/** Enough of a host for the plugin to start: it logs, and it reads files. */
const input = (): PluginInput =>
  ({
    directory: home,
    client: {
      app: {
        log: async ({ body }: { body: { message: string } }) => {
          logged.push(body.message)
          return {}
        },
      },
      file: { read: async () => ({ data: undefined }) },
    },
  }) as unknown as PluginInput

/** Review's server half, as v1 would load it. */
const start = async (): Promise<Hooks> =>
  partsToV1Hooks(await createReviewServer()(serverFromV1(input()), undefined))

/** The branch is whatever git says in a directory that is not a repository: nothing. */
const store = () => createPersistence(reviewPaths(home, undefined, { COCKPIT_HOME: home }))

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_000000001",
  file: "src/config.ts",
  line: 3,
  entries: [{ author: "you", body: "why thirty?", at: 1 }],
  status: "open",
  ...over,
})

const systemOf = async (hooks: Hooks): Promise<string[]> => {
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]?.({} as never, output as never)
  return output.system
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cockpit-review-plugin-"))
  process.env.COCKPIT_HOME = home
  logged = []
})
afterEach(async () => {
  process.env.COCKPIT_HOME = undefined
  await rm(home, { recursive: true, force: true })
})

describe("what the agent is told", () => {
  test("the three tools, and nothing it has to be told about twice", async () => {
    const hooks = await start()
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual(["review_list", "review_open", "review_reply"])
  })

  test("how the review works, once per conversation", async () => {
    const hooks = await start()
    const system = await systemOf(hooks)
    expect(system.join("\n")).toContain("review_list")
    expect(system.join("\n")).toContain("review_reply")
  })

  /** The guidance says the agent can leave notes of its own, so the tool for it has to exist. */
  test("nothing the guidance promises is missing from the tools", async () => {
    const hooks = await start()
    const system = (await systemOf(hooks)).join("\n")
    for (const name of Object.keys(hooks.tool ?? {})) {
      if (system.includes(name)) expect(hooks.tool?.[name]).toBeDefined()
    }
    expect(system).toContain("open threads yourself")
    expect(hooks.tool?.review_open).toBeDefined()
  })

  /** The count is a second line, added only when there is one to add — so it is counted, not matched. */
  test("and what is actually waiting, so it does not have to ask to find out there is nothing", async () => {
    const hooks = await start()
    expect(await systemOf(hooks)).toHaveLength(1)

    await store().save(thread())
    const said = await systemOf(hooks)
    expect(said).toHaveLength(2)
    expect(said[1]).toContain("1 review comment")
    expect(said[1]).toContain("src/config.ts")
  })

  /**
   * Waiting on *it*, not merely unresolved. A thread the agent answered is waiting on the person, and
   * a note the agent opened is its own — counting either would send it back to work it has done.
   */
  test("its own work does not come back round as work it is waiting on", async () => {
    await store().save(thread({ status: "answered" }))
    await store().save(
      thread({
        id: "rv_000000002",
        status: "answered",
        entries: [{ author: "agent", body: "noted", at: 2 }],
      }),
    )
    const hooks = await start()
    expect(await systemOf(hooks)).toHaveLength(1)
  })

  test("a review it cannot read is no reason to fail a conversation", async () => {
    await rm(home, { recursive: true, force: true })
    const hooks = await start()
    expect((await systemOf(hooks)).length).toBeGreaterThan(0)
  })
})

describe("two copies of Review", () => {
  /** One from the bundle, one installed directly: the second stands down rather than double-register. */
  test("the second registers nothing, and says why in the log", async () => {
    const host = serverFromV1(input())
    const first = await createReviewServer({ source: "opencode-cockpit" })(host, undefined)
    const second = await createReviewServer({ source: "@opencode-cockpit/review" })(host, undefined)
    expect(Object.keys(first.tools ?? {})).toHaveLength(3)
    expect(second.tools).toBeUndefined()
    await Bun.sleep(5)
    expect(logged.join(" ")).toContain("Review")
  })
})
