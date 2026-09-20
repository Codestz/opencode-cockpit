/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Thread } from "../core/model/thread.ts"
import { threadWhere } from "../core/model/thread.ts"

export interface AskOptions {
  title: string
  description: string
  /** The thread being answered, shown above the field so replying is not done blind. */
  thread?: Thread
  /** The code the thread was written against, for a new note on a line. */
  quoted?: string[]
  value?: string
}

/**
 * Writing a note, or answering one.
 *
 * The host's own prompt dialog, rather than a text field of our own: it is the one surface OpenCode
 * focuses and re-renders without argument, it already handles editing and escape, and it looks like
 * everything else in the app. Shell reaches for the same thing for the same reason.
 *
 * **What is being answered is shown above the field.** The first version opened an empty box titled
 * "Reply", which is the same box you get for a new comment — so answering meant remembering what you
 * were answering, while the thing you were answering was hidden behind the dialog.
 */
export function askForNote(
  api: TuiPluginApi,
  { title, description, thread, quoted, value }: AskOptions,
  onConfirm: (text: string) => void,
  onClose?: () => void,
): void {
  const DialogPrompt = api.ui.DialogPrompt
  const theme = () => api.theme.current

  const context = () => {
    const rows: { text: string; tone: "muted" | "accent" | "success" | "text" }[] = []
    for (const line of quoted ?? []) rows.push({ text: line, tone: "muted" })
    for (const entry of thread?.entries ?? []) {
      rows.push({
        text: entry.author === "agent" ? "agent" : "you",
        tone: entry.author === "agent" ? "success" : "accent",
      })
      rows.push({ text: entry.body, tone: "text" })
    }
    return rows
  }

  const colour = (tone: "muted" | "accent" | "success" | "text") => {
    const current = theme()
    if (tone === "muted") return current.textMuted
    if (tone === "accent") return current.accent
    if (tone === "success") return current.success
    return current.text
  }

  api.ui.dialog.replace(
    () => (
      <DialogPrompt
        title={title}
        description={() => (
          <box flexDirection="column">
            <text>
              <span style={{ fg: theme().textMuted }}>{description}</span>
            </text>
            {thread ? (
              <text>
                <span style={{ fg: theme().textMuted }}>{`${threadWhere(thread)} · ${thread.status}`}</span>
              </text>
            ) : null}
            {context().map((row) => (
              <text wrapMode="word">
                <span style={{ fg: colour(row.tone) }}>{row.text}</span>
              </text>
            ))}
          </box>
        )}
        placeholder="what should change, and why"
        value={value ?? ""}
        onConfirm={(text: string) => {
          api.ui.dialog.clear()
          onClose?.()
          const trimmed = text.trim()
          if (trimmed) onConfirm(trimmed)
        }}
        onCancel={() => {
          api.ui.dialog.clear()
          onClose?.()
        }}
      />
    ),
    /** Dismissed any other way — escape, a click outside — still has to give the keys back. */
    () => onClose?.(),
  )
}
