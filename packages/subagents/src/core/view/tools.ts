/**
 * How each kind of call is drawn, in one table — what used to be a set of boxed names and a switch
 * of labels, kept in step by hand.
 *
 *   shell    a box: `$ command`, then what it printed
 *   file     a box: `← Edit path`, its arguments verbatim when open, then the output
 *   quiet    one line (`→ Read path`) — a run of them reads as one list; opening one boxes it
 *   task     one line naming the subagent it launched; `enter` goes to that subagent
 *   todos    the checklist itself
 *   web      one line: the URL, or the query
 *   generic  anything else — MCP tools, other plugins' tools, `ask_advisor`: one line while its
 *            arguments are short, a box with every argument drawn by type once they are not
 *
 * Pure, like the rest of `core/`.
 */

import { toolTarget } from "../model/model.ts"

export type Kind = "shell" | "file" | "quiet" | "task" | "todos" | "web" | "generic"

export interface Renderer {
  kind: Kind
  /** The glyph OpenCode puts before a call. */
  icon: string
  /** `Read`, `context7 · query-docs`, `ask_advisor`. */
  title: string
}

const TABLE: Record<string, Renderer> = {
  bash: { kind: "shell", icon: "$", title: "Shell" },
  shell: { kind: "shell", icon: "$", title: "Shell" },
  edit: { kind: "file", icon: "←", title: "Edit" },
  multiedit: { kind: "file", icon: "←", title: "Edit" },
  write: { kind: "file", icon: "←", title: "Write" },
  patch: { kind: "file", icon: "←", title: "Patch" },
  apply_patch: { kind: "file", icon: "←", title: "Patch" },
  read: { kind: "quiet", icon: "→", title: "Read" },
  list: { kind: "quiet", icon: "→", title: "List" },
  ls: { kind: "quiet", icon: "→", title: "List" },
  glob: { kind: "quiet", icon: "✱", title: "Glob" },
  grep: { kind: "quiet", icon: "✱", title: "Grep" },
  task: { kind: "task", icon: "◉", title: "Task" },
  subagent: { kind: "task", icon: "◉", title: "Task" },
  todowrite: { kind: "todos", icon: "☐", title: "Todos" },
  todoread: { kind: "todos", icon: "☐", title: "Todos" },
  webfetch: { kind: "web", icon: "%", title: "WebFetch" },
  websearch: { kind: "web", icon: "◈", title: "WebSearch" },
}

/** OpenCode names an MCP tool `<server>_<tool>`, the server's name with anything odd made `_`. */
const sanitize = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")

/**
 * The renderer for a call. An MCP tool is titled `server · tool` only when its server is one we were
 * told about: guessing from the name alone would read `ask_advisor` as a tool `advisor` on a server
 * `ask`, and a wrong title is worse than the plain name.
 */
export function rendererOf(name: string, servers: readonly string[] = []): Renderer {
  const known = TABLE[name]
  if (known) return known
  let server: string | undefined
  for (const each of servers) {
    const prefix = `${sanitize(each)}_`
    if (name.startsWith(prefix) && name.length > prefix.length && (!server || each.length > server.length))
      server = each
  }
  if (server)
    return { kind: "generic", icon: "⚙", title: `${server} · ${name.slice(sanitize(server).length + 1)}` }
  return { kind: "generic", icon: "⚙", title: name }
}

const str = (input: Record<string, unknown>, key: string): string | undefined =>
  typeof input[key] === "string" ? (input[key] as string) : undefined

/** What follows the title on a call's line. */
export function targetOf(name: string, kind: Kind, input: Record<string, unknown>): string {
  switch (kind) {
    case "task":
      return [str(input, "subagent_type"), str(input, "description")].filter(Boolean).join(" · ")
    case "web": {
      const query = str(input, "query")
      return str(input, "url") ?? (query ? `"${query}"` : "")
    }
    case "todos":
      return ""
    case "generic": {
      /**
       * The first short, one-line string — `libraryId`, a path. A long one is not a target; it is the
       * argument the box draws in full, and flattened onto the title line it only duplicates it.
       */
      const first = Object.values(input).find(
        (value): value is string => typeof value === "string" && value.length <= 80 && !value.includes("\n"),
      )
      return first ?? ""
    }
    default:
      return toolTarget(name, input)
  }
}

export interface Todo {
  content: string
  status: string
}

/**
 * A todo call's list: what it was given, or — for `todoread`, and a `todowrite` whose input never
 * arrived — what it answered. Undefined when neither holds a list, and the call is drawn generic.
 */
export function todosOf(input: Record<string, unknown>, output: string): Todo[] | undefined {
  const from = (value: unknown): Todo[] | undefined =>
    Array.isArray(value)
      ? value
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => ({
            content: typeof item.content === "string" ? item.content : String(item.content ?? ""),
            status: typeof item.status === "string" ? item.status : "pending",
          }))
      : undefined
  const given = from(input.todos)
  if (given) return given
  const text = output.trim()
  if (!text.startsWith("[")) return undefined
  try {
    return from(JSON.parse(text))
  } catch {
    return undefined
  }
}
