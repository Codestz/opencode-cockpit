import { describe, expect, test } from "bun:test"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { commandOf, filterShells, matchByName } from "../src/tools/find.ts"

let seq = 0
const shell = (title: string, command: string, over: Partial<ShellInfo> = {}): ShellInfo => ({
  id: `sh_${String(seq++).padStart(8, "a")}`,
  title,
  command: "/bin/zsh",
  args: ["-c", command],
  cwd: "/p",
  owner: { project: "/p", session: "ses_me" },
  status: "running",
  run: 1,
  startedAt: 1,
  cols: 80,
  rows: 24,
  lines: { first: 1, last: 0 },
  bytes: 0,
  ...over,
})

const db = shell("DB Monitoring", "watch -n5 psql -c 'select * from jobs'")
const dev = shell("Next.js dev server", "npm run dev", { owner: { project: "/p", session: "ses_other" } })
const tests = shell("unit tests", "bun test", { status: "exited", exitCode: 1 })
const build = shell("build", "npm run build", { status: "exited", exitCode: 0, owner: { project: "/p" } })
const all = [db, dev, tests, build]

describe("filterShells", () => {
  test("query matches name or command, ignoring case", () => {
    expect(filterShells(all, { query: "db mon" })).toEqual([db])
    expect(filterShells(all, { query: "PSQL" })).toEqual([db])
    expect(filterShells(all, { query: "npm run" })).toEqual([dev, build])
  })

  test("status: running, failed, finished", () => {
    expect(filterShells(all, { status: "running" })).toEqual([db, dev])
    expect(filterShells(all, { status: "failed" })).toEqual([tests])
    expect(filterShells(all, { status: "finished" })).toEqual([tests, build])
  })

  test("session: this, others (including shells started by the user)", () => {
    expect(filterShells(all, { session: "this", currentSession: "ses_me" })).toEqual([db, tests])
    expect(filterShells(all, { session: "others", currentSession: "ses_me" })).toEqual([dev, build])
  })

  test("filters combine", () => {
    expect(
      filterShells(all, { query: "npm", status: "running", session: "others", currentSession: "ses_me" }),
    ).toEqual([dev])
  })
})

describe("matchByName", () => {
  test("exact name, ignoring case and surrounding spaces", () => {
    expect(matchByName(all, "  db monitoring ")).toMatchObject({ kind: "found", shell: db })
  })

  test("partial match on name or command when nothing matches exactly", () => {
    expect(matchByName(all, "dev server")).toMatchObject({ kind: "found", shell: dev })
    expect(matchByName(all, "psql")).toMatchObject({ kind: "found", shell: db })
  })

  test("an exact name beats partial matches elsewhere", () => {
    const exactBuild = matchByName([...all, shell("rebuild docs", "make docs")], "build")
    expect(exactBuild).toMatchObject({ kind: "found", shell: build })
  })

  test("same name twice: the single running one wins and the others are reported", () => {
    const old = shell("DB Monitoring", "psql", { status: "killed" })
    const result = matchByName([old, db], "DB Monitoring")
    expect(result).toMatchObject({ kind: "found", shell: db })
    expect(result.kind === "found" && result.alsoMatched).toEqual([old])
  })

  test("genuinely ambiguous names are not guessed", () => {
    const twin = shell("DB Monitoring", "psql other", { owner: { project: "/p", session: "ses_other" } })
    expect(matchByName([db, twin], "db monitoring")).toMatchObject({
      kind: "ambiguous",
      candidates: [db, twin],
    })
  })

  test("no match lists what exists", () => {
    expect(matchByName(all, "redis")).toMatchObject({ kind: "none", available: all })
  })
})

test("commandOf unwraps the shell -c wrapper", () => {
  expect(commandOf(db)).toBe("watch -n5 psql -c 'select * from jobs'")
  expect(commandOf({ ...db, command: "node", args: ["server.js"] })).toBe("node server.js")
})
