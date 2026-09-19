import { contextUsed, type StatusContext } from "./context.ts"
import { shortModel } from "./format.ts"

/**
 * The escape hatch: a shell command whose stdout becomes a segment.
 *
 * It is fed the same JSON on stdin that Claude Code's statusLine hook sends, so a statusline
 * script someone already wrote works here unchanged. That matters more than elegance — nobody
 * rewrites a working statusline to try a new editor.
 *
 * Unlike Claude Code's, this is not on the draw path: the command runs on its own interval and the
 * line renders whatever it last returned, so a slow script makes the value stale rather than making
 * the interface stutter.
 */

/**
 * Claude Code's statusLine stdin payload, as close as our data allows.
 *
 * The fields real statuslines actually read are the context-window ones — a script that draws a
 * capacity bar wants `context_window.used_percentage`, not a token total it has to divide itself.
 * `rate_limits` is deliberately absent: it describes an Anthropic plan's quota, which has no
 * meaning behind a proxy or another provider, and inventing a number there would be worse than
 * the field being missing.
 */
export interface ClaudeCodeStatusInput {
  hook_event_name: "Status"
  session_id: string
  session_name?: string
  cwd: string
  model: { id: string; display_name: string }
  workspace: { current_dir: string; project_dir: string; git_worktree?: string }
  version: string
  output_style: { name: string }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window?: {
    used_percentage: number
    remaining_percentage: number
    context_window_size: number
    total_input_tokens: number
    total_output_tokens: number
  }
  current_usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens: number
    cache_read_tokens: number
  }
  exceeds_200k_tokens: boolean
}

export function claudeCodeInput(ctx: StatusContext): ClaudeCodeStatusInput {
  const session = ctx.session
  const model = session?.model
  const tokens = session?.tokens
  const used = contextUsed(tokens)
  const limit = model?.contextLimit

  const payload: ClaudeCodeStatusInput = {
    hook_event_name: "Status",
    session_id: session?.id ?? "",
    cwd: ctx.directory,
    model: {
      id: model?.modelID ?? "",
      display_name: model ? shortModel(model.modelID) : "",
    },
    workspace: { current_dir: ctx.directory, project_dir: ctx.worktree },
    version: ctx.version,
    output_style: { name: "default" },
    cost: {
      total_cost_usd: session?.cost ?? 0,
      total_duration_ms: session?.startedAt ? Math.max(0, ctx.now - session.startedAt) : 0,
      total_lines_added: session?.diff.additions ?? 0,
      total_lines_removed: session?.diff.deletions ?? 0,
    },
    exceeds_200k_tokens: used > 200_000,
  }
  if (session?.title) payload.session_name = session.title
  if (ctx.worktree) payload.workspace.git_worktree = ctx.worktree
  if (tokens) {
    payload.current_usage = {
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_creation_tokens: tokens.cache.write,
      cache_read_tokens: tokens.cache.read,
    }
  }
  // Only when a window was actually declared: a script dividing by a made-up size draws a
  // confident wrong bar, which is the one thing worse than an empty segment.
  if (tokens && limit && limit > 0) {
    const share = Math.min(100, (used / limit) * 100)
    payload.context_window = {
      used_percentage: Number(share.toFixed(2)),
      remaining_percentage: Number((100 - share).toFixed(2)),
      context_window_size: limit,
      total_input_tokens: tokens.input + tokens.cache.read + tokens.cache.write,
      total_output_tokens: tokens.output + tokens.reasoning,
    }
  }
  return payload
}
