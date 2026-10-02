/**
 * What the main agent is told about subagents, once per request — written for the tool it actually
 * has.
 *
 * Measured (docs/opencode/agents.md): OpenCode 2's `subagent` tool always takes `background`.
 * OpenCode 1's `task` tool shows the model a `background` field only when OpenCode was started with
 * `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`, which a plugin cannot set. Worse, 1.18.32 still
 * *parses* the field without it: a model told "use background: true if your tool offers it" sent
 * `"true"` twelve times in one real session, got a schema error each time, and concluded background
 * was broken. So the guidance never mentions an option the tool does not have, and says how to run
 * subagents side by side without it.
 *
 * Pure: the environment is passed in.
 */

/**
 * Whether OpenCode 1 offers `background` on `task`: its flag, or the umbrella `OPENCODE_EXPERIMENTAL`
 * when the flag is unset — OpenCode's own rule (`RuntimeFlags`, read off 1.18.32). Booleans as
 * OpenCode's config reads them: true, yes, on, 1, y.
 */
export function backgroundOffered(
  version: 1 | 2,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (version === 2) return true
  const flag = parseFlag(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS)
  return flag ?? parseFlag(env.OPENCODE_EXPERIMENTAL) ?? false
}

function parseFlag(value: string | undefined): boolean | undefined {
  const text = value?.trim().toLowerCase()
  if (!text) return undefined
  if (["true", "yes", "on", "1", "y"].includes(text)) return true
  if (["false", "no", "off", "0", "n"].includes(text)) return false
  return undefined
}

/** The tool and argument that continue a subagent, for the OpenCode in use. */
export function continueHow(version: 1 | 2): string {
  return version === 1
    ? "call the task tool with its id as task_id"
    : "call the subagent tool with its id as sessionID"
}

export function subagentsGuidance({ version, background }: { version: 1 | 2; background: boolean }): string {
  const launch = background
    ? [
        `When you delegate independent work to a subagent, launch it in the background — background: true, a boolean — so this conversation continues while it works; you are notified when it finishes. Work on something else meanwhile, or tell the user what you launched.`,
        `If you have nothing else to do and need a background subagent's result, call subagents_wait instead of sleeping or polling.`,
      ]
    : [
        `Your task tool has no background option in this OpenCode (OpenCode 1 offers it only when started with OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true), so never pass background: each task call returns when its subagent answers. To run independent subagents at the same time, call the task tool for each of them in the same message — they run in parallel, and you continue when the last one answers.`,
      ]
  return [
    "## Subagents (opencode-cockpit)",
    ...launch,
    `When the user asks for a fix or follow-up on work a subagent already did, continue that same subagent (${continueHow(version)}) rather than launching a new one — it keeps its context. subagents_list gives each subagent's id, task, state and last answer; subagents_read gives one subagent's full answer and what it did.`,
    `A subagent that was cancelled or failed can be continued the same way, and keeps what it did. A "Task cancelled" or "aborted" result usually means it was stopped from outside — the user interrupted, or your own turn was stopped — not that it cannot run: read it with subagents_read before deciding to continue it or start over, and never retry with another subagent's id.`,
    "The user can watch each subagent and message it directly; when they do, a note in this conversation tells you what they asked and what it answered.",
  ].join("\n")
}
