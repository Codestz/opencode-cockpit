/**
 * The agent half against a host made of an object: a call heard starting, then OpenCode 2's
 * `evaluate` for the permission it asks — answered before any request exists, or left to be asked.
 * The ledger and the rules snapshot are real files; what is checked is when it answers, what it
 * writes, and every way it stays out. That `execute.before` comes before `evaluate` is read from
 * 2.0.18's binary (docs/opencode/permissions.md), not measured here.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { silentLog } from "@opencode-cockpit/client/log"
import type { PermissionAsk, ServerHost, ServerParts } from "@opencode-cockpit/client/server"
import { createAnswerer } from "../src/agent/answer.ts"
import { DEFAULTS, resolveSettings } from "../src/core/config.ts"
import { createEngine } from "../src/core/engine.ts"
import type { Event } from "../src/core/ledger.ts"
import { type TrustPaths, trustPaths } from "../src/core/paths.ts"
import { rulesConfig, rulesFrom } from "../src/core/rules.ts"
import { plainHash } from "../src/core/secret.ts"
import { createTrustServer } from "../src/server.ts"
import { createJournal } from "../src/tui/journal.ts"
import { snapshotReader, writeSnapshot } from "../src/tui/snapshot.ts"

const DIRECTORY = "/work/app"
/** OpenCode 2's config, as its `config.get` hands it over: documents, lowest first. */
const ASK_SHELL = [
  { type: "document", info: { permissions: [{ action: "shell", resource: "*", effect: "ask" }] } },
]

function place() {
  const home = mkdtempSync(join(tmpdir(), "trust-agent-"))
  const env = { COCKPIT_HOME: home, HOME: home, XDG_CONFIG_HOME: join(home, "config") }
  return { env, paths: trustPaths(DIRECTORY, env) }
}

/** `line` approved by a person `times` times, in the ledger — as an interface writes it. */
async function approved(paths: TrustPaths, line: string, times: number, extra: Event[] = []) {
  const engine = createEngine(DEFAULTS)
  const events: Event[] = []
  for (let i = 0; i < times; i++) {
    const at = Date.now() - 60_000 + i * 10_000
    const { event } = engine.ask({
      request: { id: `per_${i}`, sessionID: "ses_1", permission: "bash", patterns: [line], always: [] },
      context: { line, root: DIRECTORY, hash: plainHash },
      agent: "build",
      rules: rulesFrom(ASK_SHELL),
      at,
    })
    events.push(event, ...engine.replied({ requestID: `per_${i}`, reply: "once", at: at + 1_500 }).events)
  }
  await createJournal(paths).append([...events, ...extra])
}

const ledger = async (paths: TrustPaths) => (await createJournal(paths).read()).events

let n = 0
/** The agent runs `line` in a call: heard starting, then evaluated. */
function shell(line: string | undefined, overrides: Partial<PermissionAsk> = {}) {
  n++
  const callID = `call_${n}`
  return {
    start: { sessionID: "ses_1", tool: "shell", callID, args: line === undefined ? {} : { command: line } },
    ask: {
      sessionID: "ses_1",
      agent: "build",
      action: "shell",
      resources: line === undefined ? [] : [line],
      callID,
      messageID: "msg_1",
      ...overrides,
    } satisfies PermissionAsk,
  }
}

function answerer(paths: TrustPaths, rules = snapshotReader(paths, () => true)) {
  return createAnswerer({
    directory: DIRECTORY,
    paths,
    settings: resolveSettings({}),
    hash: plainHash,
    log: silentLog,
    rules,
  })
}

const share = (paths: TrustPaths, config: unknown = ASK_SHELL) =>
  writeSnapshot(paths, { config, settings: resolveSettings({}) })

describe("answering before OpenCode asks", () => {
  test("a command approved three times is answered, and the ledger says so", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 3)
    const trust = answerer(paths)
    const { start, ask } = shell("git status")
    trust.toolBefore(start)
    expect(await trust.permission(ask)).toBe("allow")
    const written = (await ledger(paths)).slice(-2)
    expect(written.map((event) => event.type)).toEqual(["asked", "auto"])
    expect(written[1]).toMatchObject({
      type: "auto",
      session: "ses_1",
      call: start.callID,
      permission: "bash",
      agent: "build",
      items: [{ subject: "git status" }],
    })
    /** The id is Trust's own: no request existed to take one from. */
    expect((written[1] as { request: string }).request).toStartWith("trust_")
  })

  test("not yet trusted: left to be asked, and nothing written — the interface writes it", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 2)
    const before = (await ledger(paths)).length
    const trust = answerer(paths)
    const { start, ask } = shell("git status")
    trust.toolBefore(start)
    expect(await trust.permission(ask)).toBeUndefined()
    expect(await ledger(paths)).toHaveLength(before)
  })

  test("a shell call whose line was never heard is left to be asked", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 3)
    const trust = answerer(paths)
    expect(await trust.permission(shell("git status").ask)).toBeUndefined()
    const { start, ask } = shell(undefined)
    trust.toolBefore(start)
    expect(await trust.permission({ ...ask, resources: ["git status"] })).toBeUndefined()
  })

  test("without the interface's rules nothing is answered: none shared, or its interface gone", async () => {
    const { paths } = place()
    await approved(paths, "git status", 3)
    const none = answerer(paths)
    const first = shell("git status")
    none.toolBefore(first.start)
    expect(await none.permission(first.ask)).toBeUndefined()

    await share(paths)
    const gone = answerer(
      paths,
      snapshotReader(paths, () => false),
    )
    const second = shell("git status")
    gone.toolBefore(second.start)
    expect(await gone.permission(second.ask)).toBeUndefined()
  })

  test("paused in any window, nothing is answered", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 3)
    const trust = answerer(paths)
    await createJournal(paths).append([{ v: 1, at: Date.now(), type: "paused" }])
    const { start, ask } = shell("git status")
    trust.toolBefore(start)
    expect(await trust.permission(ask)).toBeUndefined()
  })

  test("outside the project is always yours, however it was asked", async () => {
    const { paths } = place()
    await share(paths)
    const trust = answerer(paths)
    const { start, ask } = shell("cat /etc/hosts")
    trust.toolBefore(start)
    expect(
      await trust.permission({ ...ask, action: "external_directory", resources: ["/etc/*"] }),
    ).toBeUndefined()
  })

  test("asked again for the same call — OpenCode re-evaluates waiting requests after an always — is left alone", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 3)
    const trust = answerer(paths)
    const { start, ask } = shell("git status")
    trust.toolBefore(start)
    expect(await trust.permission(ask)).toBe("allow")
    expect(await trust.permission(ask)).toBeUndefined()
  })

  test("two starts under one call id, as Code Mode's tools share theirs: which line asked is unknown", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 3)
    const trust = answerer(paths)
    const { start, ask } = shell("git status")
    trust.toolBefore({ ...start, tool: "execute", args: { code: "…" } })
    trust.toolBefore(start)
    trust.toolBefore({ ...start, args: { command: "rm -rf build" } })
    expect(await trust.permission(ask)).toBeUndefined()
  })

  test("a ledger that cannot be written is no answer: the person is asked", async () => {
    const { paths } = place()
    await share(paths)
    await approved(paths, "git status", 3)
    const trust = createAnswerer({
      directory: DIRECTORY,
      /** Readable where it was written, appended to where nothing can be. */
      paths: { ...paths, dir: "/dev/null/trust", events: paths.events },
      settings: resolveSettings({}),
      hash: plainHash,
      log: silentLog,
      rules: snapshotReader(paths, () => true),
    })
    const { start, ask } = shell("git status")
    trust.toolBefore(start)
    expect(await trust.permission(ask)).toBeUndefined()
  })

  test("the interface's settings decide over the entry's own", async () => {
    const { paths } = place()
    await writeSnapshot(paths, { config: ASK_SHELL, settings: resolveSettings({ threshold: 2 }) })
    await approved(paths, "git status", 2)
    const trust = answerer(paths)
    const { start, ask } = shell("git status")
    trust.toolBefore(start)
    expect(await trust.permission(ask)).toBe("allow")
  })
})

describe("the agent half's entry", () => {
  const host = (version: 1 | 2): ServerHost => ({
    version,
    directory: DIRECTORY,
    scope: {},
    session: { get: async () => undefined, notify: async () => {} },
    readFile: async () => undefined,
    log: silentLog,
  })
  const start = (version: 1 | 2, options: unknown = {}) => {
    const { env, paths } = place()
    return {
      paths,
      parts: createTrustServer({ source: `test-${Math.random()}`, env })(host(version), options),
    }
  }
  const hooks = (parts: ServerParts) => Object.keys(parts).filter((key) => key !== "dispose")

  test("OpenCode 2: hears calls and answers permissions", async () => {
    const { paths, parts } = start(2)
    const ready = await parts
    expect(hooks(ready)).toEqual(["toolBefore", "permission"])
    await share(paths)
    await approved(paths, "bun test", 3)
    const { start: call, ask } = shell("bun test")
    await ready.toolBefore?.(call)
    expect(await ready.permission?.(ask)).toBe("allow")
  })

  test("OpenCode 1 never calls a plugin before its prompt: nothing to register", async () => {
    expect(hooks(await start(1).parts)).toEqual([])
  })

  test("turned off in the settings, nothing is registered", async () => {
    expect(hooks(await start(2, { enabled: false }).parts)).toEqual([])
  })
})

describe("the rules snapshot", () => {
  test("keeps what the rules are read from and nothing else: a provider's key is not copied", () => {
    const v1 = {
      permission: { bash: { "*": "ask", "git push *": "ask" } },
      agent: { plan: { permission: { edit: "deny" }, model: "x" }, build: { model: "y" } },
      provider: { zen: { options: { apiKey: "sk-secret" } } },
    }
    const v2 = [
      {
        type: "document",
        info: { permissions: [{ action: "shell", resource: "*", effect: "ask" }], mcp: {} },
      },
      {
        type: "document",
        info: { agents: { plan: { permissions: [{ action: "edit", resource: "*", effect: "deny" }] } } },
      },
    ]
    for (const config of [v1, v2])
      for (const agent of [undefined, "plan", "build"])
        expect(rulesFrom(rulesConfig(config), agent)).toEqual(rulesFrom(config, agent))
    expect(JSON.stringify(rulesConfig(v1))).not.toContain("sk-secret")
    expect(rulesConfig(v1)).toEqual({
      permission: v1.permission,
      agent: { plan: { permission: { edit: "deny" } } },
    })
  })

  test("is read again when it changes, and removed when the interface could not read the rules", async () => {
    const { paths } = place()
    const read = snapshotReader(paths, () => true)
    expect(await read()).toBeUndefined()
    await share(paths)
    expect((await read())?.config).toEqual(ASK_SHELL)
    await writeSnapshot(paths, { config: { permission: "ask" }, settings: resolveSettings({}) })
    expect((await read())?.config).toEqual({ permission: "ask" })
    await writeSnapshot(paths, undefined)
    expect(await read()).toBeUndefined()
  })

  test("a file that is not a snapshot is none", async () => {
    const { paths } = place()
    mkdirSync(paths.dir, { recursive: true })
    writeFileSync(paths.rules, '{"v":1,"config":')
    expect(await snapshotReader(paths, () => true)()).toBeUndefined()
    writeFileSync(paths.rules, JSON.stringify({ v: 1, at: 1, pid: 1, config: {} }))
    expect(await snapshotReader(paths, () => true)()).toBeUndefined()
  })
})
