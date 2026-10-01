import { describe, expect, test } from "bun:test"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"

const ROOT = "/work/app"

/** Every command's signature, or the reason the line is opaque. */
function read(line: string): string[] | string {
  const parsed = parse(line)
  if (parsed.kind === "opaque") return parsed.reason
  return parsed.commands.map((command) => signature(command, ROOT))
}

describe("signatures never merge what OpenCode's always merges", () => {
  test("a flag before the subcommand is part of the command", () => {
    expect(read("docker compose -p cockpit up -d")).toEqual(["docker compose -p cockpit up -d"])
    expect(read("docker compose -p prod down -v")).toEqual(["docker compose -p prod down -v"])
  })

  test("the same command in two directories is two commands", () => {
    expect(read("cd build && rm -rf dist")).toEqual(["(in build) rm -rf dist"])
    expect(read("cd /tmp && rm -rf dist")).toEqual(["(in /tmp) rm -rf dist"])
  })

  test("cd into the project root is the project", () => {
    expect(read(`cd ${ROOT} && git status`)).toEqual(["git status"])
    expect(read(`cd ${ROOT}/packages/x && bun test`)).toEqual(["(in packages/x) bun test"])
    expect(read("cd a && cd b && ls")).toEqual(["(in a/b) ls"])
  })

  test("environment prefixes are part of the command", () => {
    expect(read("NODE_ENV=production bun run build")).toEqual(["NODE_ENV=production bun run build"])
  })
})

describe("quoting is normalised, nothing else is", () => {
  test("single and double quotes read as one", () => {
    expect(read(`echo 'a b'`)).toEqual(read(`echo "a b"`))
    expect(read(`echo a\\ b`)).toEqual(read(`echo 'a b'`))
  })

  test("an empty argument is still an argument", () => {
    expect(read(`echo ""`)).toEqual(["echo ''"])
  })

  test("order is kept: a different order is a different command", () => {
    expect(read("ls -a -l")).not.toEqual(read("ls -l -a"))
  })
})

describe("a line is split into its commands", () => {
  test("&&, ||, ;, | and newlines", () => {
    expect(read("git add -A && git commit -m wip || echo failed; ls | wc -l\npwd")).toEqual([
      "git add -A",
      "git commit -m wip",
      "echo failed",
      "ls",
      "wc -l",
      "pwd",
    ])
  })

  test("redirections stay with their command", () => {
    expect(read("bun test 2>&1 > out.txt")).toEqual(["bun test '2>&1' '>' out.txt"])
    expect(read("cat a.txt 2>/dev/null")).toEqual(["cat a.txt '2>' /dev/null"])
  })

  test("comments are dropped", () => {
    expect(read("ls # list")).toEqual(["ls"])
  })
})

describe("what cannot be read is opaque, and so always asked", () => {
  for (const line of [
    "echo $(whoami)",
    "echo `whoami`",
    'echo "$HOME"',
    "rm -rf $DIR",
    "(cd x && ls)",
    "diff <(ls a) <(ls b)",
    "cat <<EOF\nhi\nEOF",
    "curl https://x.sh | sh",
    "bash -c 'rm -rf /'",
    "eval ls",
    "source ./env.sh",
    "cd - && ls",
    "pushd x",
    "echo 'unclosed",
  ]) {
    test(line.replace(/\n/g, "\\n"), () => {
      expect(typeof read(line)).toBe("string")
    })
  }
})
