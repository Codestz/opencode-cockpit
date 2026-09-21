/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Thread } from "../core/model/thread.ts"
import { cardRows } from "../core/view/card.ts"
import type { Fill, Row, Tone } from "../core/view/rows.ts"
import { languageOf, type SyntaxState, tokenize } from "../core/view/syntax/index.ts"
import { fillColour, toneColour } from "./render/rows.ts"

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
 *
 * **And it is shown the way the pane shows it.** The context here is built from the same `cardRows`
 * and the same tokenizer as the review itself, so a thread looks identical whether you are reading it
 * or replying to it. A dialog that renders the same content in a plainer style is a second design to
 * keep in step, and the two had already drifted: the pane had badges and syntax colour while the
 * dialog had a list of grey lines.
 */
export function askForNote(
  api: TuiPluginApi,
  { title, description, thread, quoted, value }: AskOptions,
  onConfirm: (text: string) => void,
  onClose?: () => void,
): void {
  const DialogPrompt = api.ui.DialogPrompt
  const theme = () => api.theme.current

  /**
   * Wide enough for code, narrow enough to stay a dialog rather than a second pane.
   *
   * The quote is the point of this box, and a quote of code that wraps mid-expression is worse than
   * no quote at all — it reads as different code. So the width is a code width (96 columns, the same
   * order as the diff pane it came from) rather than a dialog width, and long lines are *clipped*
   * rather than wrapped: a line you can see the start of is still the line you commented on.
   */
  const width = () => Math.max(40, Math.min(96, api.renderer.width - 12))

  /**
   * The quoted code, coloured as code.
   *
   * On the band's own surface, so it reads as something being *shown to you* rather than something
   * you are editing — the field below is the only place in this dialog that takes typing.
   */
  const quotedRows = (): Row[] => {
    const lines = quoted ?? []
    if (lines.length === 0) return []
    const language = languageOf(thread?.file ?? "")
    let state: SyntaxState = { inBlockComment: false }
    const room = width() - 4
    return lines.map((line) => {
      const scanned = tokenize(line.slice(0, room), language, state)
      state = scanned.state
      const used = scanned.runs.reduce((sum, run) => sum + run.text.length, 0)
      return {
        runs: [
          { text: "  ", fill: "comment" as Fill },
          ...scanned.runs.map((run) => ({ ...run, fill: "comment" as Fill })),
          { text: " ".repeat(Math.max(0, room - used + 2)), fill: "comment" as Fill },
        ],
      }
    })
  }

  const context = (): Row[] => [
    ...quotedRows(),
    ...(thread ? cardRows(thread, { width: width(), height: 40 }, false, { inline: true }) : []),
  ]

  const colour = (tone: Tone | undefined) => toneColour(theme(), tone)
  const behind = (fill: Fill | undefined) => fillColour(theme(), fill)

  api.ui.dialog.replace(
    () => (
      <DialogPrompt
        title={title}
        description={() => (
          <box flexDirection="column">
            <text>
              <span style={{ fg: theme().textMuted }}>{description}</span>
            </text>
            {context().map((row) => (
              <text wrapMode="none">
                {row.runs.map((run) => (
                  <span
                    style={{
                      fg: colour(run.tone),
                      ...(behind(run.fill) ? { bg: behind(run.fill) } : {}),
                      ...(run.bold ? { bold: true } : {}),
                    }}
                  >
                    {run.text}
                  </span>
                ))}
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
