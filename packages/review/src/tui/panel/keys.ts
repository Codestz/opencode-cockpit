/**
 * Which key does what, as a table and nothing else.
 *
 * Separate from the verbs so a key can change without touching what it does — and so the whole set can
 * be read at once, which is how the duplicate was spotted: `s` submitted and `S` switched source, two
 * meanings on one letter separated only by a shift.
 *
 * The layer is **global, not targeted**. A layer with a `target` matches the *keymap host's* focused
 * target, which stays the prompt whatever `focus()` is called on our own box — so scoping by target
 * silently never fires. Global means these letters are really taken, which is why the layer is
 * disposed the moment the review closes.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Guard } from "../../core/guard.ts"
import { metrics } from "../../core/perf.ts"
import type { Actions } from "./actions.ts"

type Layer = Parameters<Host["keymap"]["registerLayer"]>[0]
type Command = NonNullable<Layer["commands"]>[number]

/**
 * Every key through the guard, and counted.
 *
 * Wrapped here, at the one place commands are registered, rather than at twenty call sites — a safety
 * net with a hole in it because somebody forgot a line is not a safety net.
 */
const guarded = (guard: Guard, commands: Command[]): Command[] =>
  commands.map((command) => ({
    ...command,
    run: (...args: Parameters<Command["run"]>) => {
      metrics.count("keys")
      guard.run(command.name.replace("cockpit.review.", ""), () => command.run(...args))
    },
  }))

export function paneLayer(actions: Actions, guard: Guard): Layer {
  return {
    priority: 100,
    commands: guarded(guard, [
      { name: "cockpit.review.pane.down", title: "Down", run: () => actions.move(1) },
      { name: "cockpit.review.pane.up", title: "Up", run: () => actions.move(-1) },
      { name: "cockpit.review.pane.swap", title: "Switch pane", run: () => actions.swap() },
      {
        name: "cockpit.review.pane.enter",
        title: "Open a file, or fold a folder",
        run: () => actions.enter(),
      },
      { name: "cockpit.review.pane.scrollDown", title: "Scroll down", run: () => actions.scroll(5) },
      { name: "cockpit.review.pane.scrollUp", title: "Scroll up", run: () => actions.scroll(-5) },
      {
        name: "cockpit.review.pane.comment",
        /**
         * One key for saying something.
         *
         * A thread where you are standing means you are answering it; no thread means you are starting
         * one. Two keys was two things to remember for a difference the cursor already knows, and the
         * wrong guess cost you the note you had begun writing.
         */
        title: "Comment here, or reply to the thread here",
        run: () => actions.commentOrReply(),
      },
      {
        name: "cockpit.review.pane.commentFile",
        title: "Comment on the whole file",
        run: () => actions.comment(true),
      },
      { name: "cockpit.review.pane.select", title: "Select lines", run: () => actions.selectRange() },
      {
        name: "cockpit.review.pane.submit",
        title: "Hand the review to the agent",
        run: () => actions.submit(),
      },
      {
        name: "cockpit.review.pane.uncomment",
        title: "Remove the thread here",
        run: () => actions.uncomment(),
      },
      { name: "cockpit.review.pane.files", title: "Back to the file list", run: () => actions.toFiles() },
      {
        name: "cockpit.review.pane.read",
        title: "Mark read, and go to the next unread",
        run: () => actions.markRead(),
      },
      {
        name: "cockpit.review.pane.source",
        title: "Next source (uncommitted ↔ branch)",
        run: () => actions.nextSource(),
      },
      {
        name: "cockpit.review.pane.base",
        title: "Compare the branch against…",
        run: () => actions.chooseBase(),
      },
      {
        name: "cockpit.review.pane.fold",
        title: "Fold or unfold this file",
        run: () => actions.toggleFold(),
      },
      { name: "cockpit.review.pane.reload", title: "Reload the diff", run: () => actions.reload() },
      { name: "cockpit.review.pane.cycle", title: "Right pane or full screen", run: () => actions.cycle() },
      {
        name: "cockpit.review.pane.quit",
        title: "Close the review",
        /**
         * Escape closes the nearest thing first, and the close is deferred: closing disposes the layer
         * this handler is dispatching through.
         */
        run: () => setTimeout(() => actions.close(), 0),
      },
      {
        name: "cockpit.review.pane.stats",
        title: "Show what the review is costing",
        run: () => actions.toggleStats(),
      },
    ]),
    bindings: [
      { key: "j,down", cmd: "cockpit.review.pane.down", desc: "Down" },
      { key: "k,up", cmd: "cockpit.review.pane.up", desc: "Up" },
      { key: "tab", cmd: "cockpit.review.pane.swap", desc: "Switch pane" },
      { key: "return,l,right", cmd: "cockpit.review.pane.enter", desc: "Open or fold" },
      { key: "d,pagedown", cmd: "cockpit.review.pane.scrollDown", desc: "Scroll down" },
      { key: "u,pageup", cmd: "cockpit.review.pane.scrollUp", desc: "Scroll up" },
      { key: "c,n", cmd: "cockpit.review.pane.comment", desc: "Note, or reply" },
      { key: "f", cmd: "cockpit.review.pane.commentFile", desc: "Comment on the file" },
      { key: "v", cmd: "cockpit.review.pane.select", desc: "Select lines" },
      { key: "h,left", cmd: "cockpit.review.pane.files", desc: "Back to the files" },
      { key: "x", cmd: "cockpit.review.pane.uncomment", desc: "Remove thread" },
      { key: "space,m", cmd: "cockpit.review.pane.read", desc: "Mark read" },
      { key: "z", cmd: "cockpit.review.pane.fold", desc: "Fold" },
      /** Source is `b`, not `s`, because `s` submits — and a key that sends may not sit beside one that looks. */
      { key: "b", cmd: "cockpit.review.pane.source", desc: "Next source" },
      { key: "shift+b", cmd: "cockpit.review.pane.base", desc: "Base" },
      { key: "g", cmd: "cockpit.review.pane.reload", desc: "Reload" },
      { key: "w", cmd: "cockpit.review.pane.cycle", desc: "Width" },
      { key: "p", cmd: "cockpit.review.pane.stats", desc: "Numbers" },
      { key: "s", cmd: "cockpit.review.pane.submit", desc: "Submit" },
      { key: "q,escape", cmd: "cockpit.review.pane.quit", desc: "Close" },
    ],
  }
}
