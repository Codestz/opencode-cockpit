/**
 * What a permission request is a request *for*, as the things an approval can be counted against.
 *
 * Each permission type has its own notion of "the same thing again":
 *
 * | permission | one subject per | e.g. |
 * | --- | --- | --- |
 * | `bash` (v2 `shell`) | command, by its exact signature | `git status`, `(in web) bun test` |
 * | `edit` | file path | `src/app.ts` |
 * | `webfetch` | host | `docs.example.com` |
 * | `task` (v2 `subagent`) | agent type | `explore` |
 * | `external_directory`, `doom_loop` | — never answered | |
 * | anything else | the request's patterns, together | `opencode_read_mcp_resource` `*` |
 *
 * The key a count is kept under is the subject *and* the permission *and* the agent: trust earned
 * by `build` running `git push` is not trust for `general` to run it.
 */

import { dangerOf } from "./danger.ts"
import { canonical } from "./rules.ts"
import { type Command, parse } from "./shell.ts"
import { signature } from "./signature.ts"

/** A permission request, whichever OpenCode asked it (see `adapt/`). */
export interface Request {
  id: string
  sessionID: string
  /** Canonical: `bash`, `edit`, `task`… (`rules.canonical`). */
  permission: string
  /** What OpenCode matched against config: v1 `patterns`, v2 `resources`. */
  patterns: string[]
  /** What OpenCode's own "always" would approve: v1 `always`, v2 `save`. */
  always: string[]
  /** The tool call that asked, so a later surface can mark it answered by Trust. */
  call?: string
  messageID?: string
}

/** Everything about the call that the request itself does not carry. */
export interface Context {
  /** The command line as the agent wrote it — a bash request's patterns lose `cd`. */
  line?: string
  /** The tool's own working directory argument (v1 `workdir`, v2 `cwd`). */
  workdir?: string
  /** The project's directory: signatures name places relative to it. */
  root: string
}

export interface Subject {
  /** The exact thing counted: a signature, a path, a host… */
  subject: string
  /** What config is matched against for this subject: the command as written, the path, the URL. */
  texts: string[]
  /** Why it costs more trust, when it does. */
  danger?: string
}

export type Keyed =
  | {
      kind: "subjects"
      subjects: Subject[]
      /**
       * The request's own patterns. They are what OpenCode checked its rules against, so a specific
       * `ask` matching any of them holds the whole request, even where our reading of it differs.
       */
      patterns: string[]
    }
  /** Never answered by Trust, whatever the count. */
  | { kind: "never"; why: string }
  /** Cannot be read for certain, so it is asked — and nothing is counted. */
  | { kind: "opaque"; why: string }

/** Permissions Trust never answers: they exist to make a person look. */
const NEVER: Record<string, string> = {
  external_directory: "outside the project — always yours to answer",
  doom_loop: "the agent is repeating itself — always yours to answer",
}

/** A command's words as OpenCode's patterns spell them: for matching config, not for counting. */
const written = (command: Command): string => [...command.env, ...command.argv].join(" ")

function bash(request: Request, context: Context): Keyed {
  if (context.line === undefined) return { kind: "opaque", why: "the command line was not available" }
  const parsed = parse(context.line)
  if (parsed.kind === "opaque") return { kind: "opaque", why: parsed.reason }
  const subjects = parsed.commands.map((command): Subject => {
    const placed = withWorkdir(command, context.workdir)
    const danger = dangerOf(placed)
    return {
      subject: signature(placed, context.root),
      texts: [written(command)],
      ...(danger ? { danger } : {}),
    }
  })
  if (subjects.length === 0) return { kind: "opaque", why: "nothing on the line runs" }
  return { kind: "subjects", subjects, patterns: request.patterns }
}

/** The tool's working directory, under any `cd` the line made. */
function withWorkdir(command: Command, workdir: string | undefined): Command {
  if (!workdir) return command
  if (!command.cwd) return { ...command, cwd: workdir }
  if (command.cwd.startsWith("/") || command.cwd.startsWith("~")) return command
  return { ...command, cwd: `${workdir.replace(/\/+$/, "")}/${command.cwd}` }
}

function host(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.host || undefined
  } catch {
    return undefined
  }
}

export function subjectsOf(request: Request, context: Context): Keyed {
  const permission = canonical(request.permission)
  const never = NEVER[permission]
  if (never) return { kind: "never", why: never }
  if (permission === "bash") return bash(request, context)
  if (request.patterns.length === 0) return { kind: "opaque", why: "the request names nothing" }
  if (permission === "webfetch") {
    const subjects: Subject[] = []
    for (const url of request.patterns) {
      const name = host(url)
      if (!name) return { kind: "opaque", why: `not a URL: ${url}` }
      subjects.push({ subject: name, texts: [url] })
    }
    return { kind: "subjects", subjects: dedupe(subjects), patterns: request.patterns }
  }
  if (permission === "edit" || permission === "task")
    return {
      kind: "subjects",
      subjects: dedupe(request.patterns.map((p) => ({ subject: p, texts: [p] }))),
      patterns: request.patterns,
    }
  return {
    kind: "subjects",
    subjects: [{ subject: request.patterns.join(" "), texts: [...request.patterns] }],
    patterns: request.patterns,
  }
}

/** Two patterns naming one host or one file are one subject; config is checked against both. */
function dedupe(subjects: Subject[]): Subject[] {
  const by = new Map<string, Subject>()
  for (const subject of subjects) {
    const known = by.get(subject.subject)
    if (known) known.texts.push(...subject.texts)
    else by.set(subject.subject, { ...subject, texts: [...subject.texts] })
  }
  return [...by.values()]
}
