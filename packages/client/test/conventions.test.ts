import { describe, expect, test } from "bun:test"
import { readInstructions } from "../src/setup/conventions/instructions.ts"
import { projectFacts, repoOf, ticketPrefixes } from "../src/setup/conventions/project.ts"
import {
  findSections,
  SECTION_END,
  SECTION_HEADING,
  SECTION_START,
  sectionText,
  writeSection,
} from "../src/setup/conventions/section.ts"

/**
 * The second phase of /cockpit-setup writes into someone's own instructions file. What is tested is
 * the promise the tool makes: one section, replaced where it is, and every byte around it kept.
 */

const USER = "# My project\n\nUse tabs.\r\nNever push to main.\n"

const write = (text: string | undefined, body: string) => {
  const result = writeSection(text, body)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe("the section", () => {
  test("no file: created with the section alone", () => {
    const result = write(undefined, "- Start `bun run dev` as a background shell named `dev`.")
    expect(result.action).toBe("created")
    expect(result.text).toBe(
      `${SECTION_START}\n${SECTION_HEADING}\n\n- Start \`bun run dev\` as a background shell named \`dev\`.\n${SECTION_END}\n`,
    )
  })

  test("added at the end, the person's text kept byte for byte", () => {
    const result = write(USER, "- a")
    expect(result.action).toBe("added")
    expect(result.text?.startsWith(USER)).toBe(true)
    expect(result.text?.slice(USER.length)).toBe(`\n${sectionText("- a")}\n`)
  })

  test("a file without a final newline gets a blank line before the section, nothing else changes", () => {
    const result = write("no newline", "- a")
    expect(result.text).toBe(`no newline\n\n${sectionText("- a")}\n`)
  })

  test("a rerun replaces it in place, and writing the same again is a no-op", () => {
    const first = write(USER, "- a").text as string
    const after = `${first}\n## Theirs, below ours\n`
    const second = write(after, "- b\n- c")
    expect(second.action).toBe("updated")
    expect(second.text).toBe(after.replace(sectionText("- a"), sectionText("- b\n- c")))
    expect(findSections(second.text as string)).toEqual({
      ok: true,
      sections: [expect.objectContaining({ body: "- b\n- c" })],
    })
    const third = write(second.text, "- b\n- c")
    expect(third.action).toBe("unchanged")
    expect(third.text).toBe(second.text)
  })

  test("a heading the agent included is not doubled", () => {
    const result = write(undefined, `${SECTION_HEADING}\n\n- a`)
    expect(result.text?.split(SECTION_HEADING).length).toBe(2)
  })

  test("two sections become one, where the first was", () => {
    const doubled = `top\n\n${sectionText("- a")}\n\nmiddle\n\n${sectionText("- old")}\n`
    const result = write(doubled, "- new")
    expect(result.merged).toBe(1)
    expect(result.text).toBe(`top\n\n${sectionText("- new")}\n\nmiddle\n`)
  })

  test("an empty body removes it, undoing the add exactly", () => {
    const added = write(USER, "- a").text
    const removed = write(added, "")
    expect(removed.action).toBe("removed")
    expect(removed.text).toBe(USER)
  })

  test("removing the only content deletes the file", () => {
    expect(write(write(undefined, "- a").text, "  ").text).toBeUndefined()
  })

  test("CRLF files stay CRLF", () => {
    const result = write("a\r\nb\r\n", "- x\n- y")
    expect(result.text).toBe(`a\r\nb\r\n\r\n${sectionText("- x\n- y", "\r\n")}\r\n`)
  })

  test("a start marker with no end is refused, naming its line", () => {
    const result = writeSection(`one\ntwo\n${SECTION_START}\n- a\n`, "- b")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("line 3")
  })
})

describe("the AGENTS.md files", () => {
  const files: Record<string, string> = {}
  const read = (path: string) => files[path]

  test("each scope's path, whether it exists and what its section says", () => {
    files["/work/app/AGENTS.md"] = `# App\n\n${sectionText("- tickets are COM-…")}\n`
    const [project, global] = readInstructions(2, "/work/app", {}, "/home/me", read)
    expect(project).toEqual({
      scope: "project",
      path: "/work/app/AGENTS.md",
      exists: true,
      sections: 1,
      body: "- tickets are COM-…",
    })
    expect(global).toEqual({
      scope: "global",
      path: "/home/me/.config/opencode/AGENTS.md",
      exists: false,
      sections: 0,
    })
  })

  test("on OpenCode 1, a new AGENTS.md would stop it reading CLAUDE.md: said", () => {
    const only = { "/work/app/CLAUDE.md": "x", "/home/me/.claude/CLAUDE.md": "y" } as Record<string, string>
    const [project, global] = readInstructions(1, "/work/app", {}, "/home/me", (path) => only[path])
    expect(project?.shadows).toBe("/work/app/CLAUDE.md")
    expect(global?.shadows).toBe("/home/me/.claude/CLAUDE.md")
    const [v2] = readInstructions(2, "/work/app", {}, "/home/me", (path) => only[path])
    expect(v2?.shadows).toBeUndefined()
  })
})

describe("the project", () => {
  const tree = (files: Record<string, string>) => (path: string) => files[path.replace("/work/app/", "")]
  const noGit = () => undefined

  test("package.json: servers and watchers, run with the lockfile's manager; the rest listed apart", () => {
    const facts = projectFacts(
      "/work/app",
      tree({
        "package.json": JSON.stringify({
          scripts: { dev: "vite", "test:watch": "vitest --watch", test: "vitest run", build: "vite build" },
        }),
        "bun.lock": "",
      }),
      noGit,
    )
    expect(facts.packageManager).toBe("bun")
    expect(facts.longRunning).toEqual([
      { command: "bun run dev", from: 'package.json "dev": "vite"', name: "dev" },
      {
        command: "bun run test:watch",
        from: 'package.json "test:watch": "vitest --watch"',
        name: "test:watch",
      },
    ])
    expect(facts.otherScripts).toEqual(["test", "build"])
  })

  test("a Makefile's dev target, a compose file with its services, a Procfile", () => {
    const facts = projectFacts(
      "/work/app",
      tree({
        Makefile: "build:\n\tgo build\ndev:\n\tair\n",
        "compose.yaml":
          "services:\n  db:\n    image: postgres\n  cache:\n    image: redis\nvolumes:\n  data:\n",
        Procfile: "web: bin/rails server\n",
      }),
      noGit,
    )
    expect(facts.longRunning.map((each) => each.command)).toEqual([
      "make dev",
      "docker compose up",
      "bin/rails server",
    ])
    expect(facts.longRunning[1]?.from).toBe("compose.yaml (services: db, cache)")
    expect(facts.packageManager).toBeUndefined()
  })

  test("ticket keys from history, most used first; standards are not tickets", () => {
    expect(
      ticketPrefixes([
        "COM-12 fix",
        "feat/COM-40-login",
        "ENG-3 a",
        "ENG-4 b",
        "UTF-8 everywhere",
        "UTF-8",
        "COM-1",
      ]),
    ).toEqual([
      { prefix: "COM", count: 3, example: "COM-12" },
      { prefix: "ENG", count: 2, example: "ENG-3" },
    ])
    expect(ticketPrefixes(["ABC-1 once"])).toEqual([])
  })

  test("remotes, with credentials left out", () => {
    expect(repoOf("git@github.com:acme/app.git")).toBe("github.com/acme/app")
    expect(repoOf("https://bot:ghp_secret@github.com/acme/app.git")).toBe("github.com/acme/app")
    const facts = projectFacts("/work/app", tree({}), (args) =>
      args[0] === "remote"
        ? "origin\thttps://x:tok@github.com/acme/app.git (fetch)\norigin\thttps://x:tok@github.com/acme/app.git (push)\n"
        : undefined,
    )
    expect(facts.remotes).toEqual([{ name: "origin", repo: "github.com/acme/app" }])
  })
})
