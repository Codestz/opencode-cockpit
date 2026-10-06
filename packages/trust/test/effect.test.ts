/**
 * What a command does, read from its words: the flags that make a program write or run another (#44),
 * and the allowlist of plain reads Trust may learn as a family — failing closed.
 */
import { describe, expect, test } from "bun:test"
import { notRead, runsByFlag, sensitive, writesByFlag } from "../src/core/effect.ts"
import { notReadSubject } from "../src/core/family.ts"
import { type Command, parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"

function one(line: string): Command {
  const parsed = parse(line)
  if (parsed.kind !== "commands" || parsed.commands.length !== 1) throw new Error(`not one command: ${line}`)
  return parsed.commands[0] as Command
}
const argv = (line: string) => one(line).argv
/** Why it is not a plain read, redirections included, as Trust reads a stored subject. */
const why = (line: string) => notReadSubject("bash", signature(one(line), "/work/app"))
const isRead = (line: string) => why(line) === undefined

describe("flags that write a file (#44)", () => {
  for (const line of [
    "sed -i s/a/b/ f",
    "sed -i.bak s/a/b/ f",
    "sed --in-place s/a/b/ f",
    "sed -ni s/a/b/p f",
    "perl -pi -e s/a/b/ f",
    "awk -i inplace '{print}' f",
    "sort -o out.txt in.txt",
    "sort -uo out.txt in.txt",
    "tee out.txt",
    "uniq in.txt out.txt",
    "curl -o page.html https://x.test",
    "curl -O https://x.test/a.tgz",
    "wget https://x.test/a.tgz",
    "find . -name '*.tmp' -delete",
    "find . -fprint list.txt",
    "tar xf a.tar",
    "unzip a.zip",
  ])
    test(line, () => expect(writesByFlag(argv(line))).toBeDefined())

  for (const line of [
    "sed -n 1,5p f",
    "sort -rn f",
    "tee /dev/null",
    "tee",
    "uniq -c in.txt",
    "curl https://x.test",
    "wget -O - https://x.test",
    "find . -name '*.ts'",
    "tar tf a.tar",
    "unzip -l a.zip",
  ])
    test(`${line} — writes nothing`, () => expect(writesByFlag(argv(line))).toBeUndefined())

  test("under a wrapper, the program is what is read: timeout 5 sed -i …", () =>
    expect(writesByFlag(argv("timeout 5 sed -i s/a/b/ f"))).toBeDefined())
  test("after `--` a word is an operand, `-i` included", () =>
    expect(writesByFlag(argv("sed -n p -- -i"))).toBeUndefined())
})

describe("flags that run another program", () => {
  for (const line of [
    "rg --pre cat x",
    "rg --pre=./decode.sh x",
    "fd -x rm",
    "fd --exec rm",
    "sort --compress-program=gzip f",
    "git diff --ext-diff",
  ])
    test(line, () => expect(runsByFlag(argv(line))).toBeDefined())
  test("rg -n x — runs nothing", () => expect(runsByFlag(argv("rg -n x src"))).toBeUndefined())
})

describe("the read allowlist: everything that is not a plain read is said why", () => {
  for (const line of [
    "ls -la",
    "cat package.json",
    "head -30 src/app.ts",
    "tail -f log.txt",
    "wc -l src/a.ts",
    "rg -n createServer src",
    "grep -R foo src",
    "echo ---",
    "jq .name package.json",
    "sort -rn counts.txt",
    "fd -e ts",
    "eza -la",
    "strings bin/app",
    "git status --short",
    "git log --oneline -5",
    "git -C web status --short",
    "ls 2>/dev/null",
  ])
    test(`${line} is a read`, () => expect(why(line)).toBeUndefined())

  test("an env var in front is not: LD_PRELOAD can load code", () =>
    expect(why("FOO=1 head a")).toBe("it sets an environment variable"))
  for (const line of ["sudo head a", "timeout 5 head a", "xargs head"])
    test(`${line}: under a wrapper`, () => expect(why(line)).toBe("it runs under a wrapper"))
  test("a program the table does not know", () =>
    expect(why("python3 x.py")).toBe("python3 is not a known read"))
  test("awk, find and less are kept out on purpose", () => {
    for (const line of ["awk '{print}' f", "find . -name x", "less f", "xargs"])
      expect(isRead(line)).toBe(false)
  })
  test("a redirection that writes", () => expect(why("head a > out.txt")).toBe("it writes to a file"))
  test("a flag that writes, on a program that reads", () => expect(why("sort -o out f")).toContain("-o"))
  test("dangerous is never a read", () => expect(isRead("cat /dev/sda > disk.img")).toBe(false))
  for (const file of [
    ".env",
    ".env.local",
    "id_rsa",
    "~/.ssh/config",
    "~/.aws/credentials",
    "certs/server.pem",
  ])
    test(`cat ${file}: a secret file`, () => expect(why(`cat ${file}`)).toContain("may hold secrets"))
})

describe("sensitive files", () => {
  for (const word of [
    ".env",
    "app/.env.production",
    "id_ed25519",
    ".ssh/known_hosts",
    "x.key",
    "creds/credentials.json",
  ])
    test(`${word} is sensitive`, () => expect(sensitive(word)).toBe(true))
  for (const word of ["README.md", "src/env.ts", "environment.md", "keyboard.ts", "src/app.ts"])
    test(`${word} is not`, () => expect(sensitive(word)).toBe(false))
})

describe("sed: a read only when its script only prints", () => {
  for (const line of [
    "sed -n 1,50p a.ts",
    "sed -n '10,20p;30p' a",
    "sed s/foo/bar/g a",
    "sed -n /^export/p a",
    "sed -E 's/(a)/b/g' a",
    "sed -n '$=' a",
    "sed -n '/start/,/end/p' a",
    "sed 1d a",
    "sed -e 1p -e 5p a",
    "sed -n 5,+3p a",
    "sed -ne 2p a",
    "sed -ne2p a",
  ])
    test(`${line} is a read`, () => expect(why(line)).toBeUndefined())

  for (const line of [
    "sed -i s/a/b/ a",
    "sed s/a/b/w out a",
    "sed '1e date' a",
    "sed -f script.sed a",
    "sed 's|a|b|' a",
    "sed w out a",
    "sed -n '1,3p;w out' a",
    "sed -nf x a",
  ])
    test(`${line} is not`, () => expect(why(line)).toBeDefined())
})

describe("git: what only looks, and the reading form of what sometimes writes", () => {
  for (const line of [
    "git branch --show-current",
    "git branch -r --contains abc",
    "git branch --list",
    "git branch --list 'feat*'",
    "git stash list",
    "git worktree list",
    "git reflog -15",
    "git remote -v",
    "git config --get user.name",
    "git config --list",
    "git tag",
    "git check-ignore -v x",
    "git ls-remote --heads origin",
  ])
    test(`${line} is a read`, () => expect(why(line)).toBeUndefined())

  for (const line of [
    "git branch feature",
    "git branch -D x",
    "git branch -D x --list",
    "git branch -m a b",
    "git stash",
    "git stash pop",
    "git worktree add x",
    "git reflog expire",
    "git remote add o u",
    "git config user.name x",
    "git config --get --unset x",
    "git tag v1",
    "git fetch",
    "git push",
    "git log --output=x",
  ])
    test(`${line} is not`, () => expect(why(line)).toBeDefined())

  /**
   * Git's globals that run whatever their value names: `git --exec-path=/tmp status` is in family
   * `git status`, so a learned `git status` must not answer it.
   */
  for (const line of [
    "git -c core.pager=less log",
    "git --exec-path=/tmp status",
    "git --config-env=core.pager=X log",
  ])
    test(`${line} is not (runs a program through a git global)`, () => expect(why(line)).toBeDefined())
})

test("notRead takes the redirect writes it is given", () => {
  expect(notRead(one("head a"), [])).toBeUndefined()
  expect(notRead(one("head a"), ["out.txt"])).toBe("it writes to a file")
})
