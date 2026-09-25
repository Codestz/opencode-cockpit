/**
 * Subagents, built from changes. Pure: no OpenCode, no terminal — a test feeds it the changes a real
 * run produced and checks what came out.
 *
 * Every session is kept, the conversation you are in included: a subagent is only "a subagent" in
 * relation to the session it hangs under, and `subagentsOf` walks that from whichever conversation is
 * on screen.
 */

import type { Change, ToolState } from "./changes.ts"
import { taskText } from "./changes.ts"

export type Status = "starting" | "running" | "waiting" | "done" | "failed"

export type Entry =
  | { kind: "prompt"; key: string; text: string; at: number; first: boolean }
  | { kind: "thinking"; key: string; text: string; done: boolean; at: number }
  | { kind: "reply"; key: string; text: string; done: boolean; at: number }
  | {
      kind: "tool"
      call: string
      name: string
      state: ToolState
      input: Record<string, unknown>
      output: string
      error?: string
      at: number
      ended?: number
    }

export interface Session {
  id: string
  parentID?: string
  agent: string
  title: string
  /** The task it was given — its first prompt. */
  task?: string
  status: Status
  /** When the current status began: how long it has been waiting, say. */
  since: number
  error?: string
  started: number
  /** When it last went idle or failed; cleared when it works again. */
  ended?: number
  entries: Entry[]
  tokens: number
  cost: number
}

export interface Model {
  sessions: Map<string, Session>
}

export const emptyModel = (): Model => ({ sessions: new Map() })

function session(model: Model, id: string, at: number): Session {
  let found = model.sessions.get(id)
  if (!found) {
    found = {
      id,
      agent: "agent",
      title: "",
      status: "starting",
      since: at,
      started: at,
      entries: [],
      tokens: 0,
      cost: 0,
    }
    model.sessions.set(id, found)
  }
  return found
}

const findText = (s: Session, kind: "thinking" | "reply", key: string) =>
  s.entries.find(
    (entry): entry is Extract<Entry, { kind: "thinking" | "reply" }> =>
      entry.kind === kind && entry.key === key,
  )

const findTool = (s: Session, call: string) =>
  s.entries.find(
    (entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool" && entry.call === call,
  )

function applyStatus(s: Session, change: Extract<Change, { type: "status" }>): void {
  if (change.status === "busy") {
    s.status = "running"
    delete s.ended
    delete s.error
  } else if (change.status === "waiting") {
    s.status = "waiting"
  } else if (change.status === "failed") {
    s.status = "failed"
    s.ended = change.at
    if (change.error) s.error = change.error
  } else if (s.status !== "failed") {
    /** Idle before it ever worked is a session that has not started, not one that finished. */
    s.status = s.status === "starting" && s.entries.length === 0 ? "starting" : "done"
    s.ended = change.at
  }
}

/** Applies one change in place. Unknown sessions are created, so order never loses anything. */
export function apply(model: Model, change: Change): void {
  const s = session(model, change.id, change.at)
  switch (change.type) {
    case "session":
      if (change.parentID) s.parentID = change.parentID
      if (change.agent) s.agent = change.agent
      if (change.title) s.title = change.title
      return
    case "status": {
      const before = s.status
      applyStatus(s, change)
      if (s.status !== before) s.since = change.at
      return
    }
    case "prompt": {
      if (s.entries.some((entry) => entry.kind === "prompt" && entry.key === change.key)) return
      const first = !s.entries.some((entry) => entry.kind === "prompt")
      const text = first ? taskText(change.text) : change.text.trim()
      if (first) s.task = text
      s.entries.push({ kind: "prompt", key: change.key, text, at: change.at, first })
      return
    }
    case "thinking":
    case "reply": {
      let entry = findText(s, change.type, change.key)
      if (!entry) {
        const created: Extract<Entry, { kind: "thinking" | "reply" }> = {
          kind: change.type,
          key: change.key,
          text: "",
          done: false,
          at: change.at,
        }
        s.entries.push(created)
        entry = created
      }
      if (change.text !== undefined) entry.text = change.text
      else if (change.delta) entry.text += change.delta
      if (change.done) entry.done = true
      if (s.status === "starting") s.status = "running"
      return
    }
    case "tool": {
      let entry = findTool(s, change.call)
      if (!entry) {
        entry = {
          kind: "tool",
          call: change.call,
          name: change.name ?? "tool",
          state: "pending",
          input: {},
          output: "",
          at: change.at,
        }
        s.entries.push(entry)
      }
      if (change.name) entry.name = change.name
      if (change.state) entry.state = change.state
      if (change.input && Object.keys(change.input).length > 0) entry.input = change.input
      if (change.output !== undefined) entry.output = change.output
      if (change.error) entry.error = change.error
      if (change.state === "completed" || change.state === "failed") entry.ended = change.at
      if (s.status === "starting") s.status = "running"
      return
    }
    case "usage":
      if (change.tokens !== undefined) s.tokens = change.tokens
      if (change.cost !== undefined) s.cost = change.cost
      return
  }
}

export function applyAll(model: Model, changes: Iterable<Change>): Model {
  for (const change of changes) apply(model, change)
  return model
}

// ---------------------------------------------------------------------------------------------------
// What the views ask

export interface Node {
  session: Session
  /** 0 for a subagent of the conversation on screen, 1 for one it launched, … */
  depth: number
}

/** The subagents under `root`, depth first, oldest first at each level. */
export function subagentsOf(model: Model, root: string): Node[] {
  const children = new Map<string, Session[]>()
  for (const s of model.sessions.values()) {
    if (!s.parentID) continue
    const list = children.get(s.parentID) ?? []
    list.push(s)
    children.set(s.parentID, list)
  }
  const out: Node[] = []
  const seen = new Set<string>()
  const walk = (parent: string, depth: number) => {
    const list = (children.get(parent) ?? []).sort((a, b) => a.started - b.started)
    for (const s of list) {
      if (seen.has(s.id)) continue // a cycle in parentage would otherwise never end
      seen.add(s.id)
      out.push({ session: s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/** The conversation a session belongs to: up its parents to the one with none. */
export function rootOf(model: Model, id: string): string {
  let at = id
  for (let hop = 0; hop < 16; hop++) {
    const parent = model.sessions.get(at)?.parentID
    if (!parent) return at
    at = parent
  }
  return at
}

const base = (path: string) => path.split("/").filter(Boolean).slice(-2).join("/")

/** What a tool call is *about*, in a few words: the file, the pattern, the command. */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined)
  const path = str("filePath") ?? str("path") ?? str("file")
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "patch":
    case "list":
    case "ls":
      return path ? base(path) : ""
    case "grep":
      return [str("pattern") ? `"${str("pattern")}"` : "", str("include") ?? (path ? base(path) : "")]
        .filter(Boolean)
        .join(" ")
    case "glob":
      return str("pattern") ?? ""
    case "bash":
    case "shell":
      return (str("command") ?? "").replace(/\s+/g, " ").trim()
    case "task":
    case "subagent":
      return str("description") ?? ""
    case "webfetch":
      return str("url") ?? ""
    default: {
      const first = Object.values(input).find((value) => typeof value === "string") as string | undefined
      return first ? first.replace(/\s+/g, " ") : ""
    }
  }
}

export interface Activity {
  kind: "starting" | "tool" | "thinking" | "writing" | "waiting" | "done" | "failed"
  /** The tool's name, for `tool`. */
  tool?: string
  text: string
  /** When the current thing started, for its elapsed time. */
  since: number
}

/** What a subagent is doing right now — the line under its name in the sidebar. */
export function activityOf(s: Session): Activity {
  if (s.status === "failed") return { kind: "failed", text: s.error ?? "failed", since: s.ended ?? s.started }
  if (s.status === "waiting") return { kind: "waiting", text: "waiting for permission", since: s.since }
  const tools = s.entries.filter((entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool")
  if (s.status === "done") {
    return {
      kind: "done",
      text: `${tools.length} tool${tools.length === 1 ? "" : "s"}`,
      since: s.ended ?? s.started,
    }
  }
  const last = s.entries.at(-1)
  const running = tools.filter((tool) => tool.state === "running" || tool.state === "pending").at(-1)
  if (running)
    return {
      kind: "tool",
      tool: running.name,
      text: toolTarget(running.name, running.input),
      since: running.at,
    }
  if (last?.kind === "thinking" && !last.done) return { kind: "thinking", text: "thinking", since: last.at }
  if (last?.kind === "reply" && !last.done)
    return { kind: "writing", text: "writing its answer", since: last.at }
  if (s.status === "starting") return { kind: "starting", text: "starting", since: s.started }
  return { kind: "thinking", text: "thinking", since: last?.at ?? s.started }
}

/** Counts for the block's heading. */
export function countsOf(nodes: readonly Node[]): {
  total: number
  running: number
  done: number
  failed: number
} {
  const of = (test: (s: Session) => boolean) => nodes.filter((node) => test(node.session)).length
  return {
    total: nodes.length,
    running: of((s) => s.status === "running" || s.status === "starting" || s.status === "waiting"),
    done: of((s) => s.status === "done"),
    failed: of((s) => s.status === "failed"),
  }
}
