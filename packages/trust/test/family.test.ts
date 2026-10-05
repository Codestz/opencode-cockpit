import { describe, expect, test } from "bun:test"
import {
  anyOf,
  covers,
  familyOf,
  outside,
  readSubject,
  shown,
  showSubject,
  spelled,
  spelledSubject,
  widenable,
} from "../src/core/family.ts"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"

const ROOT = "/work/app"

/** A line as Trust keys it: the signature of its one command, under the project root. */
function subject(line: string): string {
  const parsed = parse(line)
  if (parsed.kind !== "commands" || parsed.commands.length !== 1) throw new Error(`not one command: ${line}`)
  return signature(parsed.commands[0] as never, ROOT)
}
const family = (line: string) => familyOf("bash", subject(line))

describe("a command's family", () => {
  const table: [string, string][] = [
    ["ls", "ls"],
    ["ls -la", "ls"],
    ["ls -x", "ls"],
    ["ls -R docs", "ls"],
    ["echo ---", "echo"],
    ["git status", "git status"],
    ["git status --short", "git status"],
    ["git -C /x status", "git status"],
    /** A `-c` reads as a target (a context, for most tools): a finer family, never a wider one. */
    ["git -c core.pager=less log", "git -c core.pager=less log"],
    ["git stash drop", "git stash drop"],
    ["git stash list", "git stash list"],
    /** Pushing to `main` and to a feature branch are two families. */
    ["git push origin main", "git push origin main"],
    /** The project is the target: `-p dev up` and `-p prod up` were one family, and widening it trusted prod. */
    ["docker compose -p cockpit up -d", "docker compose -p cockpit up"],
    ["docker compose -p prod down -v", "docker compose -p prod down"],
    ["docker compose -f a.yml -p x logs -f api", "docker compose -f a.yml -p x logs -f api"],
    ["docker run --rm -it alpine", "docker run"],
    ["docker container rm x", "docker container rm x"],
    ["podman compose up", "podman compose up"],
    ["kubectl -n prod get pods", "kubectl -n prod get pods"],
    ["kubectl rollout restart deploy/x", "kubectl rollout restart"],
    ["npm run test", "npm run test"],
    ["npm run build", "npm run build"],
    ["npm test", "npm test"],
    ["npm install left-pad", "npm install left-pad"],
    ["pnpm --filter web run build", "pnpm run build"],
    ["yarn workspace web build", "yarn workspace web build"],
    ["bun test src/a.test.ts", "bun test"],
    ["bun run lint", "bun run lint"],
    ["terraform plan -out x", "terraform plan"],
    ["terraform state rm x", "terraform state rm x"],
    ["cargo build --release", "cargo build"],
    ["go test ./...", "go test"],
    ["go mod tidy", "go mod tidy"],
    ["make -C web test", "make test"],
    /** Wrappers stay in the family: trusting any `ls` is not trusting it as root. */
    ["sudo ls", "sudo ls"],
    ["sudo -u www ls -la", "sudo ls"],
    ["timeout 5 ls", "timeout ls"],
    ["nice -n 10 cargo build", "nice cargo build"],
    ["env FOO=1 ls", "env ls"],
    ["xargs rm", "xargs rm"],
    /** The environment's names, never its values; redirections are not part of it. */
    /** A value that names an environment is kept: `NODE_ENV=prod` is not `NODE_ENV=dev`. */
    ["NODE_ENV=prod npm run build", "NODE_ENV=prod npm run build"],
    ["ls > out.txt", "ls"],
    ["ls 2>&1", "ls"],
    ["ls 2> /dev/null", "ls"],
    ["/usr/bin/git status", "/usr/bin/git status"],
  ]
  for (const [line, expected] of table)
    test(`${line}  →  ${expected}`, () => {
      expect(family(line)).toBe(expected)
    })

  test("where it runs is part of the family", () => {
    const parsed = parse("cd web && bun test")
    if (parsed.kind !== "commands") throw new Error("opaque")
    const placed = signature(parsed.commands[0] as never, ROOT)
    expect(placed).toBe("(in web) bun test")
    expect(familyOf("bash", placed)).toBe("(in web) bun test")
    const spaced = signature({ env: [], argv: ["ls", "-la"], cwd: `${ROOT}/my dir` }, ROOT)
    expect(familyOf("bash", spaced)).toBe("(in 'my dir') ls")
    expect(readSubject(spaced)).toEqual({ place: "my dir", command: { env: [], argv: ["ls", "-la"] } })
  })

  test("an edit's family is its folder; a fetch and an agent type are themselves", () => {
    expect(familyOf("edit", "src/app.ts")).toBe("src/")
    expect(familyOf("edit", "src/view/rows.ts")).toBe("src/view/")
    expect(familyOf("edit", "README.md")).toBe("./")
    expect(familyOf("write", "src/a.ts")).toBe("src/")
    expect(familyOf("webfetch", "docs.example.com")).toBe("docs.example.com")
    expect(familyOf("task", "explore")).toBe("explore")
  })
})

describe("which families can be widened", () => {
  test("a safe family can", () => {
    for (const each of [
      "ls",
      "echo",
      "git status",
      "docker compose up",
      "docker compose down",
      "npm run test",
    ])
      expect(widenable("bash", each)).toEqual({ ok: true })
    expect(widenable("edit", "src/")).toEqual({ ok: true })
  })

  test("a dangerous family never can, and says why", () => {
    for (const each of ["rm", "git push", "sudo ls", "kubectl delete", "terraform apply", "npm publish"]) {
      const said = widenable("bash", each)
      expect(said.ok).toBe(false)
      if (!said.ok) expect(said.why).toContain("dangerous")
    }
    expect(widenable("bash", "sudo ls")).toEqual({
      ok: false,
      why: "sudo ls is dangerous (sudo) — each one earns trust on its own",
    })
  })

  test("a fetch or an agent type is already as wide as it goes", () => {
    expect(widenable("webfetch", "docs.example.com").ok).toBe(false)
    expect(widenable("task", "explore").ok).toBe(false)
  })
})

describe("what a widened family covers", () => {
  test("any command in it", () => {
    for (const line of ["ls", "ls -la", "ls -R docs", "ls -x src"])
      expect(covers("bash", "ls", subject(line))).toBe(true)
    expect(covers("bash", "docker compose -p x up", subject("docker compose -p x up -d"))).toBe(true)
    /** Another project is another family: a widening for one never reaches the other. */
    expect(covers("bash", "docker compose -p x up", subject("docker compose -p y up -d"))).toBe(false)
  })

  test("not another family", () => {
    expect(covers("bash", "ls", subject("sudo ls"))).toBe(false)
    expect(covers("bash", "npm run test", subject("npm run deploy"))).toBe(false)
    expect(covers("bash", "ls", subject("cd web && ls"))).toBe(false)
  })

  test("not a dangerous command inside a safe family", () => {
    expect(outside("bash", subject("docker compose -p prod down -v"))).toBe("dangerous (compose down -v)")
    expect(covers("bash", "docker compose -p dev down", subject("docker compose -p dev down -v"))).toBe(false)
    expect(covers("bash", "docker compose -p dev down", subject("docker compose -p dev down"))).toBe(true)
    /** Anything that names production is dangerous, so no widening covers it. */
    expect(outside("bash", subject("docker compose -p prod down"))).toBe("dangerous (production)")
    expect(covers("bash", "git stash drop", subject("git stash drop"))).toBe(false)
  })

  test("not a command that writes a file through a redirection", () => {
    expect(outside("bash", subject("ls > out.txt"))).toBe("it writes to a file")
    expect(outside("bash", subject("ls >> log"))).toBe("it writes to a file")
    expect(outside("bash", subject("ls &> all.txt"))).toBe("it writes to a file")
    /** Throwing output away, or joining two streams, writes nothing. */
    expect(outside("bash", subject("ls 2> /dev/null"))).toBeUndefined()
    expect(outside("bash", subject("ls 2>&1"))).toBeUndefined()
    expect(outside("bash", subject("ls < list.txt"))).toBeUndefined()
  })

  test("not a command that runs another program", () => {
    expect(outside("bash", subject("find . -exec curl x {} +"))).toBe("it runs another program")
    expect(outside("bash", subject("git -c core.pager=evil log"))).toBe("it runs another program")
    expect(outside("bash", subject("git --config-env=a=b status"))).toBe("it runs another program")
    /** `-c` after the subcommand is the subcommand's own flag. */
    expect(outside("bash", subject("git commit -c HEAD"))).toBeUndefined()
  })
})

describe("showing a command so no font can merge it", () => {
  test("punctuation and ligature runs are quoted", () => {
    expect(shown("---")).toBe('"---"')
    expect(shown("->")).toBe('"->"')
    expect(shown("==")).toBe('"=="')
    expect(shown("!=")).toBe('"!="')
    expect(shown("<=")).toBe('"<="')
    expect(shown(">=")).toBe('">="')
    expect(shown("www")).toBe('"www"')
    expect(shown("a->b")).toBe('"a->b"')
    expect(shown("..")).toBe('".."')
  })

  test("ordinary words are left alone", () => {
    for (const word of ["ls", "-la", "--force", "src/app.ts", "feat/trust", "a=b", ".", "-", "~/x"])
      expect(shown(word)).toBe(word)
  })

  test("spaces, quotes and the empty word read back as one argument", () => {
    expect(shown("a b")).toBe('"a b"')
    expect(shown("")).toBe('""')
    expect(shown('say "hi"')).toBe('"say \\"hi\\""')
    expect(shown("it's")).toBe('"it\'s"')
    expect(shown("$HOME")).toBe('"\\$HOME"')
    expect(shown("a\nb")).toBe("$'a\\nb'")
  })

  test("a whole subject, its place and its redirections", () => {
    expect(showSubject("bash", subject("echo ---"))).toBe('echo "---"')
    expect(showSubject("bash", subject("echo 'a b' \"c\""))).toBe('echo "a b" c')
    expect(showSubject("bash", subject("ls > out.txt"))).toBe("ls > out.txt")
    expect(showSubject("bash", subject("ls 2>&1"))).toBe("ls 2>&1")
    expect(showSubject("bash", subject("NODE_ENV='a b' npm test"))).toBe('NODE_ENV="a b" npm test')
    expect(showSubject("bash", "(in 'my dir') ls")).toBe('(in "my dir") ls')
    expect(showSubject("bash", "NODE_ENV=… npm run build")).toBe("NODE_ENV=… npm run build")
    expect(showSubject("edit", "src/app.ts")).toBe("src/app.ts")
  })

  test("what a widening answers, in words", () => {
    expect(anyOf("bash", "ls")).toBe("any ls …")
    expect(anyOf("edit", "src/")).toBe("any file in src/")
  })
})

describe("arguments a font could merge are said in words", () => {
  test("runs of punctuation are spelled", () => {
    expect(spelled("---")).toBe("3 hyphens")
    expect(spelled("->")).toBe("hyphen, greater-than")
    expect(spelled("==")).toBe("2 equals signs")
    expect(spelled("plain")).toBeUndefined()
  })

  test("only arguments that are punctuation alone get a note", () => {
    expect(spelledSubject("bash", "echo ---")).toBe("3 hyphens")
    expect(spelledSubject("bash", "ls ../src")).toBeUndefined()
    expect(spelledSubject("bash", "curl https://example.com")).toBeUndefined()
    expect(spelledSubject("bash", "echo hello")).toBeUndefined()
    expect(spelledSubject("edit", "src/a.ts")).toBeUndefined()
  })
})
