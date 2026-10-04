/**
 * What the interface does: read and append the trail file (every window, and the agent half, append
 * to it), open and copy a link, and `/link` — a link recorded by you, through the agent's own door.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import type { Journal } from "../core/journal.ts"
import { arrange, conversationThings } from "../core/model.ts"
import type { TrailPaths } from "../core/paths.ts"
import type { Event } from "../core/store.ts"
import { markdownOf } from "../core/text.ts"
import { linkArgs, runAdd } from "../core/tools.ts"
import { openUrl } from "./open.ts"
import type { Live } from "./paint.ts"
import type { Sessions } from "./source.ts"

export type Toast = (message: string, variant?: "info" | "success" | "warning" | "error") => void

export interface Actions {
  /** Reads what was appended since the last read. */
  sync(): Promise<void>
  /** Appends, then reads; false when the file could not be written. */
  write(events: readonly Event[]): Promise<boolean>
  /** Live titles for All conversations: written-down titles can be a conversation's first, placeholder one. */
  listTitles(): Promise<void>
  toast: Toast
  open(url: string): void
  copy(text: string, what: string): void
  /** `/link`: asks for the link, then records it. */
  link(): Promise<void>
  /** The palette's "Copy this conversation's trail as markdown". */
  copyConversation(): void
}

export function createActions(input: {
  api: Host
  log: Log
  live: Live
  journal: Journal
  paths: TrailPaths
  sessions: Sessions
  draw: () => void
}): Actions {
  const { api, log, live, journal, paths, sessions, draw } = input

  // --- the trail file ------------------------------------------------------------------------------

  /** The host's live titles over the written ones: a conversation renamed since still reads right. */
  const retitle = () => {
    for (const [id, title] of live.titles) {
      const conversation = live.state.conversations.get(id)
      if (conversation) conversation.title = title
    }
  }
  const sync = async () => {
    try {
      const before = live.state.seen.size
      live.state = await journal.sync(live.state)
      if (live.trouble?.startsWith("trail unreadable")) live.trouble = undefined
      if (live.state.seen.size !== before) {
        retitle()
        draw()
      }
    } catch (error) {
      log.error("trail unreadable", { file: paths.events, error })
      live.trouble = "trail unreadable — see cockpit.log"
      draw()
    }
  }
  const write = async (events: readonly Event[]): Promise<boolean> => {
    try {
      await journal.append(events)
      if (live.trouble?.startsWith("trail not saved")) live.trouble = undefined
      await sync()
      /** `runAdd` folded the event in already, so the read finds nothing new to draw for: draw anyway. */
      draw()
      return true
    } catch (error) {
      log.error("trail not saved", { file: paths.events, error })
      live.trouble = `trail not saved: ${(error as NodeJS.ErrnoException).code ?? "error"}`
      draw()
      return false
    }
  }
  const listTitles = () =>
    sessions
      .list()
      .then((list) => {
        for (const each of list) if (each.title) live.titles.set(each.id, each.title)
        retitle()
        draw()
      })
      .catch((error) => log.debug("session list failed", { error }))

  // --- acting --------------------------------------------------------------------------------------

  const toast: Toast = (message, variant = "info") => api.ui.toast({ variant, title: "Trail", message })

  const open = (url: string) => {
    log.debug("open", { url })
    openUrl(url, (why) => {
      log.warn("open failed", { url, why })
      toast(`Could not open the link (${why}). It is: ${url}`, "warning")
    })
  }

  const copy = (text: string, what: string) => {
    const ok = api.renderer.copyToClipboardOSC52?.(text) ?? false
    if (ok) toast(`Copied ${what}.`, "success")
    else toast(`This terminal refused the clipboard. ${what}: ${text}`, "warning")
  }

  /** Recorded by you, with `/link`, through the agent's own door, `runAdd`. */
  const addByYou = async (args: { title: string; url: string }): Promise<void> => {
    if (!live.root) {
      toast("Open a conversation first: a link belongs to the conversation it was made in.", "warning")
      return
    }
    await sync()
    const title = live.titles.get(live.root) ?? (await sessions.get(live.root))?.title
    const out = runAdd(live.state, args, {
      session: live.root,
      rootSession: live.root,
      ...(title ? { sessionTitle: title } : {}),
      by: "you",
      at: Date.now(),
    })
    if (!out.ok) {
      toast(out.text, "warning")
      return
    }
    if (!(await write([out.event]))) {
      toast("The trail could not be saved — see cockpit.log.", "error")
      return
    }
    log.info("added by you", { session: live.root, url: out.event.url })
    toast(out.text.split("\n")[0] ?? "Recorded.", "success")
  }

  const link = async () => {
    if (!live.root) {
      toast("Open a conversation first: a link belongs to the conversation it was made in.", "warning")
      return
    }
    const text = await api.ui.prompt({
      title: "Add a link to this conversation's trail",
      description: "The link, then a note if you like: https://… what it is",
      placeholder: "https://github.com/acme/web/pull/40 the checkout fix",
    })
    if (text === undefined) return
    const args = linkArgs(text)
    if (!args) return toast("Nothing added: paste a link first, then a note if you like.", "warning")
    await addByYou(args)
  }

  const copyConversation = () => {
    const root = live.root
    const arranged = arrange(root ? conversationThings(live.state, root) : [])
    if (arranged.total === 0)
      return toast(
        root ? "Nothing to copy yet: this conversation's trail is empty." : "Open a conversation first.",
      )
    copy(markdownOf(arranged), `${arranged.total} ${arranged.total === 1 ? "thing" : "things"} as markdown`)
  }

  return { sync, write, listTitles, toast, open, copy, link, copyConversation }
}
