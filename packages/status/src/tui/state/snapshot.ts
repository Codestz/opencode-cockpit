import { homedir } from "node:os"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { SessionSnapshot, StatusContext, TokenCounts } from "../../core/context.ts"

/**
 * Turns OpenCode's live state into the plain snapshot the segments read. Everything that touches
 * the plugin api lives here, so every built-in stays a pure function of its input.
 */

/** Everything a usage reading accounts for; zero means the message has not reported yet. */
function counted(tokens: TokenCounts): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

/** The session the interface is showing, when it is showing one. */
export function currentSession(api: TuiPluginApi): string | undefined {
  const route = api.route.current
  return route.name === "session" ? (route.params as { sessionID?: string }).sessionID : undefined
}

export function sessionSnapshot(api: TuiPluginApi, id: string, now: number): SessionSnapshot {
  const messages = api.state.session.messages(id)
  const status = api.state.session.status(id)
  const session = api.state.session.get(id)

  let cost = 0
  let tokens: TokenCounts | undefined
  let modelID: string | undefined
  let providerID: string | undefined
  for (const message of messages) {
    if (message.role !== "assistant") continue
    cost += message.cost ?? 0
    /**
     * The newest assistant message is what currently occupies the window -- but only once it has
     * reported its usage. A message that is still streaming carries zeroes, and taking those would
     * blank every token-based segment for the length of the turn, which reads as the line breaking
     * exactly when you are watching it.
     */
    if (message.tokens && counted(message.tokens) > 0) tokens = message.tokens
    modelID = message.modelID
    providerID = message.providerID
  }

  const model = modelID && providerID ? describeModel(api, providerID, modelID) : undefined

  let additions = 0
  let deletions = 0
  const files = api.state.session.diff(id)
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }

  const todos = api.state.session.todo(id)
  const completed = todos.filter((todo) => todo.status === "completed").length

  return {
    id,
    title: session?.title,
    status: status?.type === "busy" ? "busy" : status?.type === "retry" ? "retry" : "idle",
    ...(status?.type === "retry"
      ? { retry: { attempt: status.attempt, message: status.message, next: status.next } }
      : {}),
    ...(model ? { model } : {}),
    ...(tokens ? { tokens } : {}),
    cost,
    priced: model?.priced ?? false,
    messages: messages.length,
    ...(session?.time.created ? { startedAt: session.time.created } : { startedAt: now }),
    diff: { files: files.length, additions, deletions },
    todo: { total: todos.length, completed },
  }
}

/**
 * A model's context window and whether anyone declared prices for it. Both come from the provider
 * catalogue or from the user's own `provider.<id>.models` config — which is the only place they
 * come from behind a proxy such as LiteLLM, where the catalogue knows nothing.
 */
function describeModel(
  api: TuiPluginApi,
  providerID: string,
  modelID: string,
): SessionSnapshot["model"] & { priced: boolean } {
  const provider = api.state.provider.find((p) => p.id === providerID)
  const model = provider?.models[modelID]
  const limit = model?.limit?.context
  const cost = model?.cost
  return {
    providerID,
    modelID,
    ...(limit && limit > 0 ? { contextLimit: limit } : {}),
    priced: Boolean(cost && (cost.input > 0 || cost.output > 0)),
  }
}

export function buildContext(
  api: TuiPluginApi,
  options: { now: number; width: number; version: string; commands: Record<string, string> },
): StatusContext {
  const sessionID = currentSession(api)
  return {
    now: options.now,
    directory: api.state.path.directory,
    worktree: api.state.path.worktree,
    home: process.env.HOME ?? homedir(),
    ...(api.state.vcs?.branch ? { branch: api.state.vcs.branch } : {}),
    ...(api.state.vcs?.default_branch ? { defaultBranch: api.state.vcs.default_branch } : {}),
    version: options.version,
    ...(sessionID ? { session: sessionSnapshot(api, sessionID, options.now) } : {}),
    lsp: api.state.lsp().map((item) => ({ name: item.id, status: String(item.status) })),
    mcp: api.state.mcp().map((item) => ({ name: item.name, status: String(item.status) })),
    commands: options.commands,
    width: options.width,
  }
}
