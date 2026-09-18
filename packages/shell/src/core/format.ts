import type { LogLine, ReadResult, ShellInfo, WaitResult } from "@opencode-cockpit/protocol/shell"

const MAX_LINE = 2000

/** Compact log lines for a model: numbered, long lines cut, consecutive repeats collapsed. */
export function formatLines(lines: LogLine[]): string {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] as LogLine
    let j = i + 1
    while (j < lines.length && (lines[j] as LogLine).text === line.text) j++
    const repeats = j - i
    const text =
      line.text.length > MAX_LINE
        ? `${line.text.slice(0, MAX_LINE)}… [${line.text.length - MAX_LINE} chars cut]`
        : line.text
    out.push(
      repeats > 1
        ? `${line.n}| ${text}  (×${repeats}, lines ${line.n}-${line.n + repeats - 1})`
        : `${line.n}| ${text}`,
    )
    i = j
  }
  return out.join("\n")
}

export function describeStatus(info: ShellInfo): string {
  const ran = () => duration((info.endedAt ?? Date.now()) - info.startedAt)
  switch (info.status) {
    case "running":
      return `running (pid ${info.pid}, up ${duration(Date.now() - info.startedAt)})`
    case "exited":
      return info.exitCode === 0
        ? `exited cleanly after ${ran()}`
        : `crashed with exit code ${info.exitCode ?? "?"} after ${ran()}`
    case "killed":
      return `${stopPhrase(info)} after ${ran()}`
    case "failed":
      return `failed to start: ${info.error ?? "unknown error"}`
  }
}

/** Who ended a shell, and why — "killed by SIGTERM" alone never said which of us did it. */
function stopPhrase(info: ShellInfo): string {
  switch (info.stopReason) {
    case "timeout":
      return "stopped: hit its time limit"
    case "idle":
      return "stopped: no output for its idle limit"
    case "shutdown":
      return "stopped because the shell daemon shut down"
    case "request":
      return `stopped by ${actor(info.stoppedBy)}`
    default:
      return info.exitCode != null && info.exitCode !== 0
        ? `crashed (exit code ${info.exitCode})`
        : `killed${info.signal ? ` by ${info.signal}` : ""} from outside`
  }
}

/** Client names are wire identifiers; say them the way a person would. */
function actor(client: string | undefined): string {
  if (!client) return "a request"
  if (client.includes("tui")) return "you, from the shells panel"
  if (client.includes("server")) return "the agent"
  return client
}

export function header(info: ShellInfo): string {
  const run = info.run > 1 ? ` run=${info.run}` : ""
  return `<shell id="${info.id}" title="${info.title.replaceAll('"', "'")}" status="${info.status}"${run}>`
}

export function formatRead(info: ShellInfo, page: ReadResult, empty = "(no output yet)"): string {
  const parts = [header(info), `status: ${describeStatus(info)}`]
  if (page.truncated)
    parts.push(`(older lines were dropped from the buffer; oldest kept is ${page.firstLine})`)
  parts.push(page.lines.length > 0 ? formatLines(page.lines) : empty)
  if (page.hasMore) parts.push(`(more lines available: call shell_read with after=${page.nextCursor})`)
  parts.push("</shell>", `cursor: ${page.nextCursor}`)
  return parts.join("\n")
}

export function formatWait(result: WaitResult, timeoutSeconds: number): string {
  switch (result.reason) {
    case "pattern":
      return `condition met: pattern matched on line ${result.match?.n}: ${result.match?.text}`
    case "port":
      return "condition met: port is accepting connections"
    case "idle":
      return "condition met: no output for the idle window (the program may be waiting for input)"
    case "exit":
      return `process ended: ${describeStatus(result.info)}`
    case "timeout":
      return `timed out after ${timeoutSeconds}s without the condition being met; the shell is still ${result.info.status}`
  }
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60 ? `${s % 60}s` : ""}`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? `${m % 60}m` : ""}`
}
