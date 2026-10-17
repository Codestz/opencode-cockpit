/**
 * 0.12: folders outside the project, and commands run from another folder.
 *
 * A folder OpenCode asks about (`external_directory`) is counted, never answered by its count, and
 * answered only through a folder a person widened — the temp dir as one family. A command the agent
 * ran after `cd packages/api` reads command first, its place after it, the program never cut.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { silentLog } from "@opencode-cockpit/client/log"
import { createAnswerer } from "../src/agent/answer.ts"
import { resolveSettings } from "../src/core/config.ts"
import { createEngine, type Engine } from "../src/core/engine.ts"
import { anyOf, familyOf, shownOf, showSubject, widenable } from "../src/core/family.ts"
import { folderFamily, folderOf, refused, shortPlace, TEMP_FAMILY, tempRootsOf } from "../src/core/folders.ts"
import { subjectsOf } from "../src/core/keys.ts"
import { ANY_AGENT } from "../src/core/ledger.ts"
import { trustPaths } from "../src/core/paths.ts"
import { rulesFrom } from "../src/core/rules.ts"
import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../src/core/sample.ts"
import { plainHash } from "../src/core/secret.ts"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"
import { suggestionsOf } from "../src/core/suggest.ts"
import { widen, widenScope } from "../src/core/view/actions.ts"
import { explorerRows } from "../src/core/view/explorer.ts"
import { familiesOf } from "../src/core/view/model.ts"
import { shownRuns } from "../src/core/view/parts.ts"
import { type Row, rowText, widthOf } from "../src/core/view/rows.ts"
import { sidebarRows } from "../src/core/view/sidebar.ts"
import { explorerModel, type Node, treeRow } from "../src/core/view/tree.ts"
import { createJournal } from "../src/tui/journal.ts"
import { snapshotReader, writeSnapshot } from "../src/tui/snapshot.ts"

const ROOT = "/work/app"
const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
const RULES = rulesFrom({ permission: { bash: "ask", external_directory: "ask" } })
const TEMP = tmpdir().replace(/\/+$/, "")
const HOME = homedir().replace(/\/+$/, "")

const OUTSIDE = "external_directory"

let n = 0
function world() {
  const engine: Engine = createEngine(SETTINGS)
  let clock = 1_000_000
  const ask = (patterns: string[], permission = OUTSIDE, line?: string) => {
    n++
    clock += 5_000
    const id = `per_${n}`
    const { judgement, event } = engine.ask({
      request: { id, sessionID: "ses_1", permission, patterns, always: [] },
      context: { root: ROOT, ...(line !== undefined ? { line } : {}) },
      agent: "build",
      rules: RULES,
      at: clock,
    })
    engine.load([event])
    return { id, judgement }
  }
  const approve = (patterns: string[], times: number) => {
    for (let i = 0; i < times; i++) {
      const { id, judgement } = ask(patterns)
      expect(judgement.answer).toBe(false)
      clock += 1_500
      engine.load(engine.replied({ requestID: id, reply: "once", at: clock }).events)
    }
  }
  const widened = (family: string) =>
    engine.load([{ v: 1, at: clock, type: "widened", permission: OUTSIDE, agent: ANY_AGENT, family }])
  const reading = () => ({ state: engine.state, settings: SETTINGS, now: clock })
  return { engine, ask, approve, widened, reading }
}

const glob = (folder: string) => `${folder.replace(/\/+$/, "")}/*`

describe("a folder outside the project, as a subject", () => {
  test("the request's glob is the folder", () => {
    expect(folderOf("/abs/dir/*")).toBe("/abs/dir/")
    expect(folderOf("/abs/dir/")).toBe("/abs/dir/")
    expect(folderOf("/abs/dir/**")).toBe("/abs/dir/")
    expect(folderOf("relative/dir/*")).toBeUndefined()
    const keyed = subjectsOf(
      { id: "1", sessionID: "s", permission: OUTSIDE, patterns: ["/srv/a/*", "/srv/a/"], always: [] },
      { root: ROOT },
    )
    expect(keyed).toMatchObject({ kind: "subjects", subjects: [{ subject: "/srv/a/" }] })
  })

  test("a folder never widened leaves the whole request yours, counting nothing", () => {
    for (const folder of [
      "/",
      HOME,
      `${HOME}/.ssh`,
      `${HOME}/.aws/sso`,
      `${HOME}/.config/opencode`,
      "/etc",
      "/work",
      ROOT,
    ]) {
      const keyed = subjectsOf(
        { id: "1", sessionID: "s", permission: OUTSIDE, patterns: [glob(folder)], always: [] },
        { root: ROOT },
      )
      expect(keyed.kind).toBe("never")
    }
  })

  test("never widened, and why: the disk, home and what holds it, keys and settings, secrets, the project's own folders", () => {
    expect(refused("/")).toBe("it is the whole disk")
    expect(refused(`${HOME}/`)).toBe("it is your home folder")
    expect(refused(`${HOME.split("/").slice(0, -1).join("/") || "/"}/`)).toBeDefined()
    expect(refused(`${HOME}/.kube/`)).toBe("keys and settings live there")
    expect(refused("/etc/nginx/")).toBe("keys and settings live there")
    expect(refused("/srv/app/secrets/")).toBe("it may hold secrets")
    expect(refused("/work/", ROOT)).toBe("it holds the project")
    expect(refused("/srv/other/", ROOT)).toBeUndefined()
    expect(refused(TEMP_FAMILY)).toBeUndefined()
    expect(widenable(OUTSIDE, `${HOME}/.docker/`).ok).toBe(false)
    expect(widenable(OUTSIDE, `${HOME}/work/other/`).ok).toBe(true)
    expect(widenable(OUTSIDE, TEMP_FAMILY).ok).toBe(true)
  })
})

describe("the temp dir is one family", () => {
  test("every name it goes by", () => {
    const roots = tempRootsOf("/var/folders/ab/xyz/T/")
    expect(roots).toContain("/var/folders/ab/xyz/T")
    expect(roots).toContain("/private/var/folders/ab/xyz/T")
    expect(roots).toContain("/tmp")
    expect(roots).toContain("/private/tmp")
    expect(tempRootsOf("/private/var/folders/ab/xyz/T")).toContain("/var/folders/ab/xyz/T")
  })

  test("its folders collapse into $TMPDIR/; any other folder is its own", () => {
    for (const folder of [`${TEMP}/opencode/a1/`, "/tmp/x/", "/private/tmp/y/z/", `${TEMP}/`])
      expect(folderFamily(folder)).toBe(TEMP_FAMILY)
    expect(familyOf(OUTSIDE, `${HOME}/work/other/`)).toBe(`${HOME}/work/other/`)
  })

  test("said as a person reads it", () => {
    expect(showSubject(OUTSIDE, `${TEMP}/opencode/a1/`)).toBe("$TMPDIR/opencode/a1/")
    expect(showSubject(OUTSIDE, `${HOME}/work/other/`)).toBe("~/work/other/")
    expect(anyOf(OUTSIDE, TEMP_FAMILY)).toBe("any folder in $TMPDIR")
    expect(anyOf(OUTSIDE, `${HOME}/work/x/`)).toBe("any file in ~/work/x/")
  })
})

describe("answered only through a folder you widened", () => {
  test("approved past the threshold, still yours", () => {
    const w = world()
    w.approve([glob(`${TEMP}/opencode/a1`)], 6)
    const { judgement } = w.ask([glob(`${TEMP}/opencode/a1`)])
    expect(judgement.answer).toBe(false)
    expect(judgement.why).toContain("outside the project")
    expect(judgement.progress[0]).toMatchObject({ have: 6, trusted: false, yours: true })
  })

  test("$TMPDIR/ widened: any temp folder is answered, under any of its names", () => {
    const w = world()
    w.widened(TEMP_FAMILY)
    for (const folder of [`${TEMP}/opencode/new`, "/tmp/scratch", "/private/tmp/other"]) {
      const { judgement } = w.ask([glob(folder)])
      expect(judgement).toMatchObject({ answer: true, why: "in a family you widened: any folder in $TMPDIR" })
    }
    expect(w.ask([glob(`${HOME}/work/other`)]).judgement.answer).toBe(false)
  })

  test("a widened folder covers what is under it, never a sibling, never a secret", () => {
    const w = world()
    w.widened(`${HOME}/work/other/`)
    expect(w.ask([glob(`${HOME}/work/other`)]).judgement.answer).toBe(true)
    expect(w.ask([glob(`${HOME}/work/other/src/deep`)]).judgement).toMatchObject({
      answer: true,
      items: [{ subject: `${HOME}/work/other/src/deep/`, via: `${HOME}/work/other/` }],
    })
    expect(w.ask([glob(`${HOME}/work/other-two`)]).judgement.answer).toBe(false)
    expect(w.ask([glob(`${HOME}/work/sibling`)]).judgement.answer).toBe(false)
    expect(w.ask([glob(`${HOME}/work/other/secrets`)]).judgement.answer).toBe(false)
    /** One folder not covered and the whole request asks. */
    expect(w.ask([glob(`${HOME}/work/other/a`), glob("/srv/b")]).judgement.answer).toBe(false)
  })

  test("the agent half answers it too, before OpenCode asks", async () => {
    const home = mkdtempSync(join(tmpdir(), "trust-outside-"))
    const paths = trustPaths(ROOT, { COCKPIT_HOME: home, HOME: home })
    const config = [
      { type: "document", info: { permissions: [{ action: "*", resource: "*", effect: "ask" }] } },
    ]
    await writeSnapshot(paths, { config, settings: resolveSettings({}) })
    const trust = createAnswerer({
      directory: ROOT,
      paths,
      settings: resolveSettings({}),
      hash: plainHash,
      log: silentLog,
      rules: snapshotReader(paths, () => true),
    })
    const ask = (folder: string, callID: string) => {
      trust.toolBefore({ sessionID: "ses_1", tool: "read", callID, args: { filePath: `${folder}/a.txt` } })
      return trust.permission({
        sessionID: "ses_1",
        agent: "build",
        action: OUTSIDE,
        resources: [glob(folder)],
        callID,
        messageID: "msg_1",
      })
    }
    expect(await ask(`${TEMP}/opencode/q1`, "call_a")).toBeUndefined()
    await createJournal(paths).append([
      { v: 1, at: Date.now(), type: "widened", permission: OUTSIDE, agent: ANY_AGENT, family: TEMP_FAMILY },
    ])
    expect(await ask(`${TEMP}/opencode/q2`, "call_b")).toBe("allow")
    expect(await ask(`${HOME}/work/other`, "call_c")).toBeUndefined()
  })
})

describe("suggested, never learned", () => {
  test("approvals across two or more temp folders reaching the threshold: $TMPDIR/ is suggested", () => {
    const w = world()
    w.approve([glob(`${TEMP}/opencode/a1`)], 2)
    w.approve([glob(`${TEMP}/opencode/b2`)], 1)
    const reading = w.reading()
    const found = suggestionsOf(reading, familiesOf(reading))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ approvals: 3, commands: 2 })
    expect(found[0]?.family.family).toBe(TEMP_FAMILY)
    expect(w.engine.state.widened.size).toBe(0)
  })

  test("one folder, however often, is not suggested: its own count already says it", () => {
    const w = world()
    w.approve([glob(`${HOME}/work/other`)], 5)
    const reading = w.reading()
    expect(suggestionsOf(reading, familiesOf(reading))).toEqual([])
  })

  test("w widens it; a folder never widened is refused", () => {
    const at = 5
    const temp = widen({ permission: OUTSIDE, family: TEMP_FAMILY, undo: false }, at)
    expect(temp.events).toEqual([
      { v: 1, at, type: "widened", permission: OUTSIDE, agent: ANY_AGENT, family: TEMP_FAMILY },
    ])
    const home = widen({ permission: OUTSIDE, family: `${HOME}/`, undo: false }, at)
    expect(home.events).toEqual([])
    expect(home.notice.text).toContain("never widened")
  })

  test("the ledger offers it, and its card says what w does in plain words", () => {
    const w = world()
    for (const id of ["a1", "b2", "c3"]) w.approve([glob(`${TEMP}/opencode/${id}`)], 2)
    const reading = { ...w.reading(), history: w.engine.history }
    const view = explorerRows({
      ...reading,
      open: new Set(),
      full: new Set(),
      filter: "",
      width: 120,
      height: 30,
      project: "app",
    })
    const text = view.rows.map(rowText).join("\n")
    expect(text).toContain("★ any folder in $TMPDIR?")
    expect(text).toContain("approved 6× across 3 folders in your temp directory")
    expect(text).toContain("[w] lets Trust answer reads and writes there from now on")
    expect(text).toContain("2× yours")
    const scope = widenScope(
      { kind: "family", family: familiesOf(reading)[0] as never, suggested: true },
      familiesOf(reading),
    )
    expect(scope).toMatchObject({ family: TEMP_FAMILY, undo: false })
  })
})

describe("a command run from another folder reads command first", () => {
  const sub = (line: string, workdir?: string) => {
    const parsed = parse(line)
    if (parsed.kind !== "commands") throw new Error(line)
    const command = parsed.commands.at(-1) as never as { cwd?: string }
    return signature(workdir ? ({ ...command, cwd: workdir } as never) : (command as never), ROOT)
  }

  test("the place after the command, short", () => {
    const placed = sub("cd packages/api && TZ=UTC npx vitest run src/a.test.ts")
    expect(placed).toStartWith("(in packages/api) ")
    expect(showSubject("bash", placed)).toBe("TZ=UTC npx vitest run src/a.test.ts  in packages/api")
    expect(shownOf("bash", placed)).toMatchObject({ place: "packages/api", lead: 7, head: 10 })
    expect(shortPlace(`${HOME}/work/support-data-uploader/scripts`)).toBe("~/…/support-data-uploader/scripts")
    expect(shortPlace(`${TEMP}/opencode/x`)).toBe("$TMPDIR/opencode/x")
    expect(shortPlace("/opt/a/b/c")).toBe("/…/b/c")
    expect(anyOf("bash", familyOf("bash", placed))).toBe("any TZ=… npx vitest run …")
  })

  test("cut to fit: the command's tail goes, never its program, and the place stays", () => {
    const shown = shownOf("bash", sub("cd packages/api && TZ=UTC npx vitest run src/routes.test.ts"))
    for (const width of [24, 30, 40, 60]) {
      const text = rowText(shownRuns(shown, width))
      expect(widthOf(text)).toBeLessThanOrEqual(width)
      expect(text).toContain("npx")
      expect(text).toMatch(/in (packages|…)\/api$/)
    }
    /** Env words that leave no room for the program go instead. */
    const long = shownOf("bash", sub("TZ=America/Bogota_and_more python3 upload.py --dry-run"))
    expect(rowText(shownRuns(long, 20))).toStartWith("… python3")
  })

  test("the tree's row, the suggestion, the card and the sidebar all say it the same way", () => {
    const engine = SAMPLES.elsewhere?.().engine as Engine
    const reading = {
      state: engine.state,
      settings: SAMPLE_SETTINGS,
      now: SAMPLE_NOW,
      history: engine.history,
    }
    const model = explorerModel({ ...reading, open: new Set(), full: new Set(), filter: "" })
    const suggest = model.nodes.find(
      (node): node is Extract<Node, { kind: "suggest" }> =>
        node.kind === "suggest" && node.suggestion.family.permission === "bash",
    ) as Node
    expect(rowText(treeRow(suggest, 80, 10, 0, false))).toContain("★ any TZ=… npx vitest run?")
    const view = explorerRows({
      ...reading,
      open: new Set(),
      full: new Set(),
      filter: "",
      width: 120,
      height: 40,
      project: "app",
      selected: model.nodes.find(
        (node) => node.kind === "command" && node.command.subject.includes("python3"),
      )?.key as string,
    })
    const text = view.rows.map(rowText).join("\n")
    expect(text).toContain("Run from ~/work/support-data-uploader/scripts — the agent")
    expect(text).not.toContain("(in ")

    const answered = sub("cd packages/api && npx vitest run src/routes.test.ts")
    const rows: Row[] = sidebarRows({
      width: 36,
      recent: [
        {
          at: 1,
          request: "r",
          permission: "bash",
          agent: "build",
          label: answered,
          subjects: [answered],
          why: "x",
        },
      ],
      count: 1,
      pending: [],
      state: engine.state,
      limit: 3,
    })
    const line = rowText(rows.at(-1) ?? [])
    expect(line).toStartWith("● npx vitest")
    expect(line).toContain("in …/api")
  })
})
