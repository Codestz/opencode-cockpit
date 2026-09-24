/**
 * `opencode-cockpit doctor`: checks a setup and says how to fix what is wrong. Facts in (`gather.ts`),
 * conclusions (`checks.ts`), then text for a person or `--json` for an issue.
 *
 * Exits 1 when a check fails, so a script can ask "is Cockpit set up" and get an answer.
 */

import { allChecks, type Check, type State } from "./checks.ts"
import { type DoctorIo, gatherFacts } from "./gather.ts"

export interface RunIo extends DoctorIo {
  write(text: string): void
  color: boolean
}

const HELP = `Usage: npx opencode-cockpit@latest doctor [--json]

  Checks OpenCode, its config, the logs Cockpit writes, the daemon and the tools it needs, and says
  what to change for anything wrong. Works on OpenCode 1 and 2, and when Cockpit will not load at all.

  --json    everything doctor found, for attaching to an issue
`

const MARK: Record<State, { text: string; code: string }> = {
  ok: { text: "✓", code: "32" },
  info: { text: "·", code: "90" },
  warn: { text: "!", code: "33" },
  fail: { text: "✗", code: "31" },
}

function render(checks: readonly Check[], color: boolean): string {
  const paint = (code: string, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
  const width = Math.max(...checks.map((check) => check.title.length)) + 2
  const pad = " ".repeat(width + 3)
  const out: string[] = ["", paint("1", "Cockpit doctor"), ""]
  for (const check of checks) {
    const mark = MARK[check.state]
    out.push(` ${paint(mark.code, mark.text)} ${check.title.padEnd(width)}${check.summary}`)
    for (const line of check.detail ?? []) out.push(paint("90", `${pad}${line}`))
    for (const line of check.fix ?? []) out.push(`${pad}${paint("36", "→")} ${line}`)
  }
  const failed = checks.filter((check) => check.state === "fail").length
  const warned = checks.filter((check) => check.state === "warn").length
  out.push(
    "",
    failed + warned === 0
      ? paint("32", "Nothing to fix.")
      : [failed && paint("31", `${failed} to fix`), warned && paint("33", `${warned} to look at`)]
          .filter(Boolean)
          .join(", "),
    paint("90", "Stuck? https://codestz.github.io/opencode-cockpit/help/troubleshooting/"),
    "",
  )
  return out.join("\n")
}

export async function doctor(argv: readonly string[], io: RunIo): Promise<number> {
  const args = argv[0] === "doctor" ? argv.slice(1) : argv
  if (args.includes("--help") || args.includes("-h")) {
    io.write(HELP)
    return 0
  }
  const unknown = args.find((arg) => arg !== "--json")
  if (unknown) {
    io.write(`unknown argument: ${unknown}\n\n${HELP}`)
    return 2
  }
  const facts = await gatherFacts(io)
  const checks = allChecks(facts)
  if (args.includes("--json")) {
    const plain = {
      ...facts,
      latest: Object.fromEntries(facts.latest),
      checkouts: [...facts.checkouts],
      checks,
    }
    io.write(`${JSON.stringify(plain, null, 2)}\n`)
  } else {
    io.write(render(checks, io.color))
  }
  return checks.some((check) => check.state === "fail") ? 1 : 0
}
