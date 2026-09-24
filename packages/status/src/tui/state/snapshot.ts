import { homedir } from "node:os"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Host, V2Context } from "@opencode-cockpit/client/host"
import type { SessionSnapshot, StatusContext, TokenCounts } from "../../core/context.ts"
import type { DiffCounts } from "../../core/diff.ts"

/**
 * Turns OpenCode's live state into the plain snapshot the segments read. Everything that touches
 * the plugin api lives here, so every built-in stays a pure function of its input.
 */

/** Before the first `git diff` comes back there is nothing to report, which is not the same as zero. */
const NOTHING: DiffCounts = { files: 0, additions: 0, deletions: 0 }

/** Everything a usage reading accounts for; zero means the message has not reported yet. */
function counted(tokens: TokenCounts): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

/** The session the interface is showing, when it is showing one. */
export function currentSession(api: Host): string | undefined {
  const route = api.route.current
  return route.name === "session" ? (route.params as { sessionID?: string }).sessionID : undefined
}

export function sessionSnapshot(
  api: TuiPluginApi,
  id: string,
  now: number,
  diff: DiffCounts,
): SessionSnapshot {
  const messages = api.state.session.messages(id)
  const status = api.state.session.status(id)
  const session = api.state.session.get(id)

  let summed = 0
  let tokens: TokenCounts | undefined
  let modelID: string | undefined
  let providerID: string | undefined
  for (const message of messages) {
    if (message.role !== "assistant") continue
    summed += message.cost ?? 0
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

  /**
   * OpenCode keeps a running total on the session record, and its own sidebar reads that. Summing
   * the messages we can see under-reports it twice over: a turn still streaming has not booked its
   * cost yet, and revert or compaction takes spent history out of the list entirely. Observed live
   * against a proxy as $0.30 here against $0.56 in the sidebar.
   *
   * The field is not in the published `Session` type, so it is read defensively and the sum stands
   * in when it is absent.
   */
  const accumulated = (session as { cost?: unknown } | undefined)?.cost
  const cost = typeof accumulated === "number" && Number.isFinite(accumulated) ? accumulated : summed

  const model = modelID && providerID ? describeModel(api, providerID, modelID) : undefined

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
    diff,
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

/** Numbers read defensively: v2's records are typed, but a field missing must read as absent, not NaN. */
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/**
 * The same snapshot from OpenCode 2's data.
 *
 * v2 keeps the running cost and the token total on the session record itself, and its assistant
 * messages carry the same token shape v1's did — so the newest message that has reported is still
 * what occupies the window. Todos are not a v2 concept, so there are none to count.
 */
export function sessionSnapshotV2(
  ctx: V2Context,
  id: string,
  now: number,
  diff: DiffCounts,
): SessionSnapshot {
  void ctx.data.session.sync?.(id).catch(() => {})
  const session = ctx.data.session.get?.(id) as
    | { title?: string; cost?: number; time?: { created?: number } }
    | undefined
  const status = ctx.data.session.status?.(id) as
    | { type?: string; attempt?: number; message?: string; next?: number }
    | undefined
  const messages = (ctx.data.session.message?.list(id) ?? []) as {
    type?: string
    tokens?: TokenCounts
    model?: { id?: string; providerID?: string }
    cost?: number
  }[]
  let tokens: TokenCounts | undefined
  let model: { id?: string; providerID?: string } | undefined
  let summed = 0
  for (const message of messages) {
    if (message.type !== "assistant") continue
    summed += num(message.cost) ?? 0
    if (message.tokens && counted(message.tokens) > 0) tokens = message.tokens
    if (message.model) model = message.model
  }
  const models = (ctx.data.location.model?.list(ctx.location) ?? []) as {
    id?: string
    providerID?: string
    limit?: { context?: number }
    cost?: unknown[]
  }[]
  const info = models.find((each) => each.id === model?.id && each.providerID === model?.providerID)
  const limit = num(info?.limit?.context)
  return {
    id,
    title: session?.title,
    status: status?.type === "busy" ? "busy" : status?.type === "retry" ? "retry" : "idle",
    ...(status?.type === "retry"
      ? { retry: { attempt: status.attempt ?? 0, message: status.message ?? "", next: status.next ?? 0 } }
      : {}),
    ...(model?.id && model.providerID
      ? {
          model: {
            providerID: model.providerID,
            modelID: model.id,
            ...(limit && limit > 0 ? { contextLimit: limit } : {}),
          },
        }
      : {}),
    ...(tokens ? { tokens } : {}),
    cost: num(session?.cost) ?? summed,
    priced: Array.isArray(info?.cost) && info.cost.length > 0,
    messages: messages.length,
    startedAt: num(session?.time?.created) ?? now,
    diff,
    todo: { total: 0, completed: 0 },
  }
}

export function buildContext(
  api: Host,
  options: {
    now: number
    width: number
    version: string
    commands: Record<string, string>
    diff?: DiffCounts
  },
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
    ...(options.diff ? { diff: options.diff } : {}),
    ...(sessionID
      ? {
          session: api.v1
            ? sessionSnapshot(api.v1, sessionID, options.now, options.diff ?? NOTHING)
            : sessionSnapshotV2(api.v2 as V2Context, sessionID, options.now, options.diff ?? NOTHING),
        }
      : {}),
    /** v2 runs no language servers; its MCP servers carry a name and a status as v1's did. */
    lsp: api.v1 ? api.v1.state.lsp().map((item) => ({ name: item.id, status: String(item.status) })) : [],
    mcp: api.v1
      ? api.v1.state.mcp().map((item) => ({ name: item.name, status: String(item.status) }))
      : (
          (api.v2?.data.location.mcp?.server.list(api.v2.location) ?? []) as {
            name?: string
            status?: unknown
          }[]
        ).map((item) => ({ name: item.name ?? "", status: String(item.status ?? "") })),
    commands: options.commands,
    width: options.width,
  }
}
