/**
 * Secrets out of the ledger (0.11): a secret's value is a keyed hash in every signature, while what
 * Trust reads to tell commands apart — an environment word, a short plain value — stays as it is.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Log } from "@opencode-cockpit/client/log"
import { dangerOf } from "../src/core/danger.ts"
import { createEngine } from "../src/core/engine.ts"
import { familyOf, readSubject } from "../src/core/family.ts"
import { trustPaths } from "../src/core/paths.ts"
import { rulesFrom } from "../src/core/rules.ts"
import { type Hasher, maskPattern, plainHash } from "../src/core/secret.ts"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"
import { keyedHash, maskHasher } from "../src/tui/key.ts"

/**
 * Made-up tokens, put together at run time so no token-shaped literal sits in the repository for a
 * secret scanner to stop a push over.
 */
const AWS = ["AKIA", "ABCDEFGHIJKLMNOP"].join("")
const GITHUB = ["ghp", "_abcdefghijklmnopqrstuvwxyz0123"].join("")
const SHOPIFY = ["shpat", "_0123456789abcdef0123456789abcdef"].join("")
const OPENAI = ["sk-proj", "-abcdefghijklmnopqrstuv"].join("")

const ROOT = "/work/app"
const sig = (line: string, hash: Hasher = plainHash) => {
  const parsed = parse(line)
  if (parsed.kind !== "commands" || parsed.commands.length !== 1) throw new Error(`not one command: ${line}`)
  return signature(parsed.commands[0] as never, ROOT, hash)
}
const MASK = /‹#[0-9a-f]{6}( [a-z ]+)?›/

describe("what is masked", () => {
  const cases: [string, string][] = [
    [`SHOPIFY_ADMIN_API_ACCESS_TOKEN=${SHOPIFY} bun run sync`, "shpat_"],
    ["TOKEN=hunter2 ./deploy.sh", "hunter2"],
    ['curl -H "Authorization: Bearer abcdef1234567890xyz" https://api.example.com', "abcdef1234567890xyz"],
    [`gh api --token ${GITHUB} repos`, "ghp_"],
    ["mysql --password=hunter2 -u root", "hunter2"],
    ["mysql --password hunter2 -u root", "hunter2"],
    [`export OPENAI_API_KEY=${OPENAI}`, "sk-proj"],
    [`echo ${AWS}`, "AKIA"],
    ["psql postgres://app:s3cretPw@db/app", "s3cretPw"],
  ]
  for (const [line, secret] of cases)
    test(line.slice(0, 60), () => {
      const subject = sig(line)
      expect(subject).not.toContain(secret)
      expect(subject).toMatch(MASK)
    })

  test("a URL keeps everything but its password", () =>
    expect(sig("psql postgres://app:s3cretPw@db/app")).toMatch(
      /^psql 'postgres:\/\/app:‹#[0-9a-f]{6}›@db\/app'$/,
    ))
})

describe("what stays readable", () => {
  for (const line of [
    "NODE_ENV=production npm run build",
    "PORT=3000 DEBUG=true bun dev",
    "aws s3 ls --profile prod",
    "git log --oneline -5",
  ])
    test(line, () => expect(sig(line)).toBe(line))

  test("a value with a space, under a name that says nothing secret", () =>
    expect(sig("NODE_ENV='a b' npm test")).toBe("'NODE_ENV=a b' npm test"))
})

describe("a masked value keeps the environment it names", () => {
  const line = "DATABASE_URL=postgres://app:s3cretPw@db-prod.internal:5432/application_db psql -c 'select 1'"

  test("the mask says prod, and nothing else of the value", () => {
    const subject = sig(line)
    expect(subject).toMatch(/DATABASE_URL=‹#[0-9a-f]{6} prod›/)
    expect(subject).not.toContain("s3cretPw")
    expect(subject).not.toContain("db-prod.internal")
  })

  test("read back, it is still production: for danger and for its family", () => {
    const read = readSubject(sig(line))
    if (!read) throw new Error("unreadable")
    expect(dangerOf(read.command)).toBe("production")
    expect(familyOf("bash", sig(line))).toContain("prod")
  })
})

describe("one value, one subject", () => {
  test("two secrets are two subjects; the same secret is the same subject", () => {
    expect(sig("TOKEN=aaaa1111 ./run")).not.toBe(sig("TOKEN=bbbb2222 ./run"))
    expect(sig("TOKEN=aaaa1111 ./run")).toBe(sig("TOKEN=aaaa1111 ./run"))
  })

  test("the hasher given is the one used", () => {
    const fixed: Hasher = () => "abcdef"
    expect(sig("TOKEN=x ./run", fixed)).toBe("'TOKEN=‹#abcdef›' ./run")
  })

  test("keyed hashes differ by key, and match under one", () => {
    expect(keyedHash("a".repeat(64))("pw")).not.toBe(keyedHash("b".repeat(64))("pw"))
    expect(keyedHash("a".repeat(64))("pw")).toBe(keyedHash("a".repeat(64))("pw"))
    expect(keyedHash("a".repeat(64))("pw")).toMatch(/^[0-9a-f]{6}$/)
  })
})

describe("OpenCode's always", () => {
  test("a pattern is masked word by word", () => {
    const masked = maskPattern(`curl --token ${GITHUB} *`, plainHash)
    expect(masked).toMatch(/^curl --token ‹#[0-9a-f]{6}› \*$/)
    expect(maskPattern("git push *", plainHash)).toBe("git push *")
  })

  test("an always given to a request reaches the ledger masked", () => {
    const engine = createEngine({ threshold: 3, dangerExtra: 5, expireDays: 30 })
    const line = `gh api --token ${GITHUB} repos`
    engine.ask({
      request: { id: "per_1", sessionID: "s", permission: "bash", patterns: [line], always: [`${line} *`] },
      context: { line, root: ROOT },
      agent: "build",
      rules: rulesFrom({ permission: { bash: "ask" } }),
      at: 1_000,
    })
    const { events } = engine.replied({ requestID: "per_1", reply: "always", at: 5_000 })
    const text = JSON.stringify(events)
    expect(events[0]?.type).toBe("approved")
    expect(text).not.toContain("ghp_")
    expect(text).toMatch(/--token ‹#[0-9a-f]{6}›/)
  })
})

describe("the project's key", () => {
  const log: Log = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child: () => log,
    file: undefined,
  }

  test("made once, readable by you alone, and the same next time", () => {
    const home = mkdtempSync(join(tmpdir(), "trust-key-"))
    const paths = trustPaths("/work/app", { COCKPIT_HOME: home })
    const first = maskHasher(paths, log)
    const key = readFileSync(paths.key, "utf8").trim()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(paths.key).mode & 0o777).toBe(0o600)
    const second = maskHasher(paths, log)
    expect(second("secret")).toBe(first("secret"))
    expect(readFileSync(paths.key, "utf8").trim()).toBe(key)
    expect(first("secret")).toBe(keyedHash(key)("secret"))
  })
})
