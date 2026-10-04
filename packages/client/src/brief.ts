/** Sending a line to the agent from the interface, on either OpenCode. */

import type { Host } from "./host.ts"

/** The session on screen, if there is one. */
function sessionOnScreen(host: Host): string | undefined {
  const route = host.route.current
  return route.name === "session"
    ? (route.params as { sessionID?: string } | undefined)?.sessionID
    : undefined
}

/**
 * Hands `text` to the agent from wherever the person is, with a toast saying it did — the effect can
 * land somewhere the screen is not showing yet. Measured on 1.18.32 and 2.0.18:
 *
 * - in a conversation, idle: sent, and the turn starts;
 * - the agent busy: queued behind the running turn, shown as queued in the conversation;
 * - home, no conversation: v1's prompt starts one when submitted; v2 gets one made and opened here.
 *
 * On the next tick, because running a slash command clears the prompt it was typed into: anything
 * written during the command itself is wiped a moment later.
 */
export function briefAgent(host: Host, text: string, title: string, done = "Asked the agent."): void {
  setTimeout(() => {
    const failed = (error?: unknown) => {
      host.log.warn("setup: could not reach the agent", { error })
      host.ui.toast({ variant: "error", title, message: "Could not reach the agent." })
    }
    const sent = () => host.ui.toast({ variant: "info", title, message: done })
    if (host.v1) {
      const tui = host.v1.client.tui
      void tui
        .appendPrompt({ text })
        .then(() => tui.submitPrompt())
        .then(sent)
        .catch(failed)
      return
    }
    void toConversation(host, text).then(
      (where) => (where ? sent() : host.ui.toast({ title, message: "Open a conversation first." })),
      failed,
    )
  }, 0)
}

/** OpenCode 2: the conversation on screen, or a new one opened for it from home. */
async function toConversation(host: Host, text: string): Promise<string | undefined> {
  const session = host.v2?.data.session
  let id = sessionOnScreen(host)
  if (!id) {
    const created = session?.create?.({})
    if (!created) return undefined
    await created.request
    host.v2?.ui.router.navigate?.({ type: "session", sessionID: created.id })
    id = created.id
  }
  /**
   * Busy, it waits its turn. v2's default hands a message to the turn that is running ("steer"),
   * which cut a reply off mid-sentence to start on this; queued, the reply finishes and the line
   * shows as `1 queued` under the conversation — what v1 does with a prompt submitted while busy.
   */
  const busy = session?.status?.(id) === "running"
  await session?.prompt?.({ sessionID: id, text, ...(busy ? { delivery: "queue" as const } : {}) })
  return id
}
