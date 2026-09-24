/** @jsxImportSource @opentui/solid */
import type { Host } from "@opencode-cockpit/client/host"
import type { BaseCandidate } from "../../core/git/sources.ts"
import { type Thread, threadWhere } from "../../core/model/thread.ts"
import { cardRows } from "../../core/view/card.ts"
import type { Fill, Row, Tone } from "../../core/view/rows.ts"
import { languageOf, type SyntaxState, tokenize } from "../../core/view/syntax/index.ts"
import { fillColour, toneColour } from "../view/pool.ts"

/**
 * What each dialog says.
 *
 * Kept here rather than beside the verbs that open them: a verb is about what changes, and none of
 * these sentences change anything. They were three blocks of copy in the middle of `panel/actions.ts`,
 * which is how "nothing is sent until you submit the review" ended up written three slightly
 * different ways.
 */
export const noteFields = (
  file: string,
  where: { from?: number; to?: number; existing?: Thread; quoted?: string[] },
): AskOptions => ({
  title: where.existing
    ? `Reply · ${file}:${threadWhere(where.existing)}`
    : where.from === undefined
      ? `Note on ${file}`
      : where.to !== undefined && where.to > where.from
        ? `Note on ${file}:${where.from}-${where.to}`
        : `Note on ${file}:${where.from}`,
  description: where.existing
    ? "Continues the thread. Nothing is sent until you submit."
    : where.from === undefined
      ? "About the file as a whole. Nothing is sent until you submit."
      : "Nothing is sent until you submit the review.",
  ...(where.existing ? { thread: where.existing } : {}),
  /** The lines being commented on, so a note is not written blind either. */
  ...(where.quoted ? { quoted: where.quoted } : {}),
})

export const replyFields = (thread: Thread): AskOptions => ({
  title: `Reply · ${thread.file}`,
  description:
    thread.status === "resolved"
      ? "Replying reopens this thread, so the agent sees it again."
      : "Continues the thread. Nothing is sent until you submit.",
  thread,
  ...(thread.quoted ? { quoted: thread.quoted } : {}),
})

/** A covering sentence is optional, so this is the one dialog that accepts an empty answer. */
export const submitFields = (label: string, comments: number): AskOptions => ({
  title: `Submit · ${label}`,
  description: `${comments} comment${comments === 1 ? "" : "s"} go to the agent. A sentence of your own is optional.`,
  allowEmpty: true,
})

export interface AskOptions {
  title: string
  description: string
  /** The thread being answered, shown above the field so replying is not done blind. */
  thread?: Thread
  /** The code the thread was written against, for a new note on a line. */
  quoted?: string[]
  value?: string
  /**
   * Whether an empty answer still counts.
   *
   * A note has to say something; a submit does not — handing over a review with no covering sentence
   * is an ordinary thing to do, and refusing it silently would look like a broken key.
   */
  allowEmpty?: boolean
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
  api: Host,
  { title, description, thread, quoted, value, allowEmpty }: AskOptions,
  onConfirm: (text: string) => void,
  onClose?: () => void,
): void {
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
    ...(thread ? cardRows(thread, { width: width(), height: 40 }, "current", { inline: true }) : []),
  ]

  const colour = (tone: Tone | undefined) => toneColour(theme(), tone)
  const behind = (fill: Fill | undefined) => fillColour(theme(), fill)

  const rich = () => (
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
  )
  /** The same context in words, for a host whose prompt takes only text (OpenCode 2). */
  const plain = [
    description,
    ...context().map((row) =>
      row.runs
        .map((run) => run.text)
        .join("")
        .trimEnd(),
    ),
  ]
    .filter((line, index) => index === 0 || line.trim())
    .join("\n")

  void api.ui
    .prompt({
      title,
      description: plain,
      rich,
      placeholder: "what should change, and why",
      value: value ?? "",
    })
    .then((text) => {
      /** However it closed, the keys come back. */
      onClose?.()
      if (text === undefined) return
      const trimmed = text.trim()
      if (trimmed || allowEmpty) onConfirm(trimmed)
    })
}

/**
 * Choosing what the branch is compared against.
 *
 * The nearest parent is a guess, and a good one, but only you know whether this stack is reviewed a
 * layer at a time or all the way down to `main` — so "auto" is the first option, and each branch says
 * how many commits of yours it would show, which is the number that decides it.
 */
export function askForBase(
  api: Host,
  {
    current,
    guessed,
    candidates,
  }: { current?: string; guessed?: string; candidates: readonly BaseCandidate[] },
  onSelect: (base: string | undefined) => void,
  onClose?: () => void,
): void {
  const AUTO = "\0auto"
  const plural = (n: number) => `${n} commit${n === 1 ? "" : "s"}`
  void api.ui
    .select<string>({
      title: "Compare the branch against",
      current: current ?? AUTO,
      options: [
        {
          title: "auto: nearest parent",
          value: AUTO,
          description: guessed ? `currently ${guessed}` : "the branch this one grew from",
        },
        ...candidates.map((each) => ({
          title: each.ref,
          value: each.ref,
          description: `${plural(each.own)} of yours${each.other ? ` · it is ${plural(each.other)} ahead` : ""}`,
        })),
      ],
    })
    .then((value) => {
      onClose?.()
      if (value !== undefined) onSelect(value === AUTO ? undefined : value)
    })
}
