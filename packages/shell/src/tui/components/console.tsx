/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { LogLine, ShellInfo } from "@opencode-cockpit/protocol/shell"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { detailRows } from "../lib/details.ts"
import { isReleaseKey, keyToBytes } from "../lib/keys.ts"
import { friendlyError, splitMatches } from "../lib/search.ts"
import {
  displayCommand,
  kindColor,
  kindOf,
  relativeCwd,
  statusDetail,
  tailLines,
  tailRuns,
  truncate,
  watchColor,
  watchLabel,
  wrapText,
} from "../lib/view.ts"
import { type ShellStore, useScreen } from "../state/store.ts"
import { Badge } from "./badge.tsx"

export interface ConsoleProps {
  api: TuiPluginApi
  store: ShellStore
  /** Start in typing mode. */
  typing?: boolean
  /** Paint the colours programs print (config: ui.colors). */
  colors?: boolean
  /** Which view a freshly opened console shows (config: ui.defaultView). */
  defaultView?: "screen" | "log"
  onClose: () => void
  onNewShell: () => void
}

type View = "screen" | "log" | "details"
type Notice = { text: string; tone: "info" | "success" | "error" }

/** Daemon errors name ids and internal states; say what happened instead. */
const COMMAND_LINES = 3

/** Splits a line into plain and matching parts so a filtered log can highlight what matched. */

/**
 * Keyboard-first shell console in an overlay. Normal mode: single-key actions. Typing mode:
 * every key goes to the program (ctrl+c included); ctrl+] returns to normal mode.
 */
export function Console(props: ConsoleProps) {
  const theme = () => props.api.theme.current
  const dims = useTerminalDimensions()
  const shell = () => props.store.selected()
  const [view, setView] = createSignal<View>(props.defaultView ?? "screen")
  const [typing, setTyping] = createSignal(props.typing ?? false)
  const [log, setLog] = createSignal<LogLine[]>([])
  const [notice, setNotice] = createSignal<Notice>()
  /** Applied log filter, and the query being typed for it. */
  const [filter, setFilter] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const { screen } = useScreen(props.store, () => shell()?.id)
  let scroll: ScrollBoxRenderable | undefined

  const running = () => shell()?.status === "running"
  const client = props.store.client

  // Layout budget. The host dialog starts at 1/4 of the height and is 116 columns wide (xlarge),
  // capped by the screen; the body grows with content up to what the header leaves.
  const frameRows = () => Math.max(10, dims().height - Math.floor(dims().height / 4) - 3)
  const bodyCols = () => Math.max(20, Math.min(116, dims().width - 2) - 7)
  const commandLines = createMemo(() => {
    const s = shell()
    return s ? wrapText(displayCommand(s), bodyCols() - 2, COMMAND_LINES) : []
  })
  const folder = createMemo(() => {
    const s = shell()
    return s ? relativeCwd(s.cwd, props.store.project()) : ""
  })
  const failure = createMemo(() => {
    const s = shell()
    if (!s?.summary) return undefined
    const kind = kindOf(s)
    return kind === "fail" || kind === "stop" ? s.summary : undefined
  })
  const bodyRows = () => {
    const header = 1 + commandLines().length + (folder() ? 1 : 0) + (failure() ? 1 : 0)
    return Math.max(3, frameRows() - header - 4) // margins (2) + footer (1) + bottom padding (1)
  }

  // Transient footer message. Replaces the key hints while shown, then clears itself.
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const flash = (text: string, tone: Notice["tone"], ms?: number) => {
    clearTimeout(noticeTimer)
    setNotice({ text, tone })
    if (ms) noticeTimer = setTimeout(() => setNotice(undefined), ms)
  }
  onCleanup(() => clearTimeout(noticeTimer))

  const act = (label: string, fn: () => Promise<unknown>) => {
    flash(`${label}…`, "info")
    fn()
      .then((result) => (typeof result === "string" ? flash(result, "success", 2500) : setNotice(undefined)))
      .catch((err) => flash(`${label} failed: ${friendlyError(err)}`, "error", 5000))
  }

  /** Actions that need a live process explain themselves instead of failing. */
  const whileRunning = (label: string, fn: (id: string) => void) => () => {
    const s = shell()
    if (!s) return
    if (s.status !== "running") {
      flash(
        `can't ${label}: this shell already ${kindOf(s) === "done" ? "finished" : "ended"} · r runs it again`,
        "info",
        3000,
      )
      return
    }
    fn(s.id)
  }

  // Log view: reload on selection, view switch and new output.
  createEffect(
    on([() => shell()?.id, view, filter, () => screen()], () => {
      const id = shell()?.id
      if (!id || view() !== "log") return
      // The daemon greps server-side, so filtering a 40k-line log costs one call, not a transfer.
      void client
        .call("shell.read", { id, tail: 2000, limit: 2000, grep: filter() || undefined, ignoreCase: true })
        .then((page) => setLog(page.lines))
        .catch(() => setLog([]))
    }),
  )

  // Typing mode: size the PTY to what we show, then forward every key.
  createEffect(
    on(typing, (on) => {
      const id = shell()?.id
      if (!on || !id || !running()) return
      setView("screen")
      void client.call("shell.resize", { id, cols: bodyCols(), rows: bodyRows() }).catch(() => {})
    }),
  )
  createEffect(() => {
    if (typing() && !running()) setTyping(false)
  })
  const release = props.api.keymap.intercept(
    "key",
    (ctx) => {
      // Search takes keys first: a typed query must reach neither the program nor the dialog.
      if (searching()) {
        const event = ctx.event
        ctx.consume({ preventDefault: true, stopPropagation: true })
        if (event.name === "escape") return setSearching(false)
        if (event.name === "return" || event.name === "enter") {
          setFilter(draft().trim())
          return setSearching(false)
        }
        if (event.name === "backspace") return setDraft((value) => value.slice(0, -1))
        if (event.sequence && !event.ctrl && !event.meta && event.sequence >= " ") {
          setDraft((value) => value + event.sequence)
        }
        return
      }
      if (!typing()) return
      const event = ctx.event
      ctx.consume({ preventDefault: true, stopPropagation: true })
      if (isReleaseKey(event)) {
        setTyping(false)
        return
      }
      const bytes = keyToBytes(event)
      const id = shell()?.id
      if (bytes && id) void client.call("shell.write", { id, data: bytes }).catch(() => setTyping(false))
    },
    { priority: 10_000 },
  )
  onCleanup(release)

  const withShell = (fn: (id: string) => void) => () => {
    const id = shell()?.id
    if (id) fn(id)
  }
  const toggle = (next: View) => setView((v) => (v === next ? "screen" : next))

  useBindings(() => ({
    enabled: () => !typing(),
    commands: [
      {
        name: "cockpit.console.type",
        title: "Type into shell",
        run: whileRunning("type", () => setTyping(true)),
      },
      {
        name: "cockpit.console.interrupt",
        title: "Send ctrl+c",
        run: whileRunning("interrupt", (id) =>
          act("interrupt", async () => {
            await client.call("shell.write", { id, data: "\x03" })
            return "sent ctrl+c"
          }),
        ),
      },
      {
        name: "cockpit.console.restart",
        title: "Restart shell",
        run: withShell((id) => act("restart", () => client.call("shell.restart", { id }))),
      },
      {
        name: "cockpit.console.stop",
        title: "Stop shell",
        run: whileRunning("stop", (id) =>
          act("stop", async () => {
            await client.call("shell.stop", { id, signal: "SIGTERM", graceMs: 3000 })
            return "stopped"
          }),
        ),
      },
      {
        name: "cockpit.console.remove",
        title: "Remove shell",
        run: withShell((id) => act("remove", () => client.call("shell.remove", { id }))),
      },
      {
        name: "cockpit.console.clear",
        title: "Clear finished shells",
        run: () => {
          if (finished() === 0) {
            flash("nothing to clear: no finished shells", "info", 2500)
            return
          }
          act("clear", async () => {
            const n = await props.store.clearFinished()
            return `cleared ${n} finished shell${n === 1 ? "" : "s"}`
          })
        },
      },
      {
        name: "cockpit.console.view",
        title: "Toggle screen/log",
        run: () => setView((v) => (v === "log" ? "screen" : "log")),
      },
      {
        name: "cockpit.console.search",
        title: "Search this shell's log",
        run: () => {
          setView("log")
          setDraft(filter())
          setSearching(true)
        },
      },
      {
        name: "cockpit.console.searchClear",
        title: "Clear the log filter",
        run: () => {
          setFilter("")
          setDraft("")
        },
      },
      { name: "cockpit.console.details", title: "Toggle details", run: () => toggle("details") },
      { name: "cockpit.console.next", title: "Next shell", run: () => props.store.step(1) },
      { name: "cockpit.console.prev", title: "Previous shell", run: () => props.store.step(-1) },
      { name: "cockpit.console.new", title: "New shell", run: () => props.onNewShell() },
      { name: "cockpit.console.down", title: "Scroll down", run: () => scroll?.scrollBy(3) },
      { name: "cockpit.console.up", title: "Scroll up", run: () => scroll?.scrollBy(-3) },
      {
        name: "cockpit.console.bottom",
        title: "Scroll to end",
        run: () => scroll?.scrollTo(scroll.scrollHeight),
      },
      { name: "cockpit.console.top", title: "Scroll to top", run: () => scroll?.scrollTo(0) },
      {
        name: "cockpit.console.scope",
        title: "This session / whole project",
        run: () => props.store.toggleScope(),
      },
      { name: "cockpit.console.close", title: "Close console", run: () => props.onClose() },
    ],
    bindings: [
      { key: "i,return", cmd: "cockpit.console.type", desc: "Type" },
      { key: "c", cmd: "cockpit.console.interrupt", desc: "^C" },
      { key: "r", cmd: "cockpit.console.restart", desc: "Restart" },
      { key: "x", cmd: "cockpit.console.stop", desc: "Stop" },
      { key: "d", cmd: "cockpit.console.remove", desc: "Remove" },
      { key: "shift+d", cmd: "cockpit.console.clear", desc: "Clear finished" },
      { key: "tab", cmd: "cockpit.console.view", desc: "Screen/log" },
      { key: "/", cmd: "cockpit.console.search", desc: "Search log" },
      { key: "backspace", cmd: "cockpit.console.searchClear", desc: "Clear filter" },
      { key: "?,shift+/", cmd: "cockpit.console.details", desc: "Details" },
      { key: "],l,right", cmd: "cockpit.console.next", desc: "Next" },
      { key: "[,h,left", cmd: "cockpit.console.prev", desc: "Prev" },
      { key: "n", cmd: "cockpit.console.new", desc: "New" },
      { key: "s", cmd: "cockpit.console.scope", desc: "Scope" },
      { key: "j,down", cmd: "cockpit.console.down", desc: "Down" },
      { key: "k,up", cmd: "cockpit.console.up", desc: "Up" },
      { key: "shift+g,end", cmd: "cockpit.console.bottom", desc: "End" },
      { key: "g,home", cmd: "cockpit.console.top", desc: "Top" },
      { key: "q", cmd: "cockpit.console.close", desc: "Close" },
    ],
  }))

  const screenText = createMemo(() => tailLines(screen()?.text, bodyRows(), bodyCols()))
  // Colour when the daemon sent styled rows; the plain text stays the fallback.
  const screenRuns = createMemo(() =>
    props.colors === false ? [] : tailRuns(screen()?.styled, bodyRows(), bodyCols()),
  )
  const details = createMemo(() =>
    shell() ? detailRows(shell() as ShellInfo, props.store.now(), bodyCols()) : [],
  )
  const bodyHeight = createMemo(() => {
    if (typing()) return bodyRows()
    const content =
      view() === "log"
        ? log().length
        : view() === "details"
          ? details().length
          : screenText().split("\n").length
    return Math.min(bodyRows(), Math.max(6, content))
  })
  const finished = createMemo(() => props.store.shells().filter((s) => s.status !== "running").length)
  const position = createMemo(() => {
    const list = props.store.shells()
    const index = list.findIndex((x) => x.id === shell()?.id)
    return list.length > 1 ? `${index + 1}/${list.length}` : ""
  })
  // Only the keys that do something for the selected shell.
  /** Only the keys that do something right now: no sidebar concepts, no actions with no target. */
  const hint = createMemo(() => {
    if (searching()) return `search: ${draft()}▏· enter filters · esc cancels`
    if (typing()) return "TYPING: keys go to the shell (ctrl+c included) · ctrl+] stop typing"
    const wide = dims().width >= 110
    const label = (long: string, short: string) => (wide ? long : short)
    const keys: string[] = []
    if (!shell()) return ["n new", "esc close"].join(" · ")
    keys.push(
      ...(running()
        ? [label("i type", "i"), label("c ^C", "c"), label("r restart", "r"), label("x stop", "x")]
        : [label("r run again", "r"), label("d remove", "d")]),
    )
    if (view() === "log" && filter()) keys.push(label("backspace clear filter", "⌫ filter"))
    keys.push(label(`tab ${view() === "log" ? "screen" : "log"}`, "tab"))
    if (view() !== "details") keys.push(label("/ search log", "/"))
    keys.push(label("? details", "?"))
    if (props.store.shells().length > 1) keys.push(label("[ ] switch", "[ ]"))
    keys.push(
      props.store.scope() === "session"
        ? label("s whole project", "s project")
        : label("s this session", "s session"),
    )
    if (finished() > 0) keys.push(label("D clear done", "D"))
    keys.push(label("n new", "n"), "esc")
    return keys.join(" · ")
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} overflow="hidden">
      <Show
        when={shell()}
        fallback={
          <box flexDirection="column">
            <text fg={theme().text} wrapMode="none">
              <b>No shells in this project</b>
            </text>
            <text fg={theme().textMuted} wrapMode="none">
              {truncate("Press n to start one. The agent starts its own with shell_start.", bodyCols())}
            </text>
          </box>
        }
      >
        {(s) => (
          <>
            <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
              <Badge api={props.api} shell={s()} frame={props.store.frame()} />
              <text fg={theme().text} wrapMode="none" flexShrink={1}>
                {" "}
                <b>{truncate(s().title, Math.max(10, bodyCols() - 50))}</b>
              </text>
              <box flexGrow={1} />
              <Show when={watchLabel(s())}>
                <text fg={watchColor(theme(), s())} wrapMode="none" flexShrink={0}>
                  {" "}
                  {watchLabel(s())}{" "}
                </text>
              </Show>
              <text fg={theme().textMuted} wrapMode="none" flexShrink={0}>
                {[statusDetail(s(), props.store.now()), s().run > 1 ? `run ${s().run}` : "", position()]
                  .filter(Boolean)
                  .join(" · ")}
              </text>
            </box>
            <For each={commandLines()}>
              {(line, index) => (
                <text fg={theme().text} wrapMode="none" flexShrink={0}>
                  <span style={{ fg: theme().textMuted }}>{index() === 0 ? "$ " : "  "}</span>
                  {line}
                </text>
              )}
            </For>
            <Show when={folder()}>
              <text fg={theme().textMuted} wrapMode="none" flexShrink={0}>
                {truncate(`in ${folder()}`, bodyCols())}
              </text>
            </Show>
            <Show when={failure()}>
              {(summary) => (
                <text fg={kindColor(theme(), kindOf(s()))} wrapMode="none" flexShrink={0}>
                  {truncate(`${kindOf(s()) === "fail" ? "error" : "last output"}: ${summary()}`, bodyCols())}
                </text>
              )}
            </Show>
            <box
              height={bodyHeight()}
              flexShrink={0}
              marginTop={1}
              marginBottom={1}
              border={["left"]}
              borderColor={typing() ? theme().accent : theme().border}
              paddingLeft={1}
              overflow="hidden"
            >
              <Show when={view() === "screen"}>
                <Show
                  when={screenRuns().length > 0}
                  fallback={
                    <text fg={theme().text} wrapMode="none">
                      {screenText() || " "}
                    </text>
                  }
                >
                  <box flexDirection="column">
                    <For each={screenRuns()}>
                      {(row) => (
                        <text fg={theme().text} wrapMode="none">
                          <For each={row}>
                            {(run) => (
                              <span style={{ fg: run.fg, bg: run.bg, bold: run.bold, italic: run.italic }}>
                                {run.text}
                              </span>
                            )}
                          </For>{" "}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </Show>
              <Show when={view() === "details"}>
                <box flexDirection="column">
                  <For each={details()}>
                    {([key, value]) => (
                      <text fg={theme().text} wrapMode="none">
                        <span style={{ fg: theme().textMuted }}>{key.padEnd(10)}</span>
                        {value}
                      </text>
                    )}
                  </For>
                </box>
              </Show>
              <Show when={view() === "log"}>
                <scrollbox
                  ref={(el: ScrollBoxRenderable) => {
                    scroll = el
                  }}
                  flexGrow={1}
                  stickyScroll={true}
                  stickyStart="bottom"
                  verticalScrollbarOptions={{ visible: false }}
                  horizontalScrollbarOptions={{ visible: false }}
                >
                  <For each={log()}>
                    {(line) => (
                      <text fg={theme().text} wrapMode="none">
                        <span style={{ fg: theme().textMuted }}>{String(line.n).padStart(5)} </span>
                        <For each={splitMatches(truncate(line.text, bodyCols() - 7), filter())}>
                          {(part) =>
                            part.match ? (
                              <span style={{ fg: theme().background, bg: theme().warning }}>{part.text}</span>
                            ) : (
                              <span>{part.text}</span>
                            )
                          }
                        </For>
                      </text>
                    )}
                  </For>
                  <Show when={filter() && log().length === 0}>
                    <text fg={theme().textMuted}>no lines match "{filter()}"</text>
                  </Show>
                </scrollbox>
              </Show>
            </box>
          </>
        )}
      </Show>

      <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
        <Show
          when={notice()}
          fallback={
            <text fg={typing() ? theme().accent : theme().textMuted} wrapMode="none">
              {truncate(hint(), bodyCols())}
            </text>
          }
        >
          {(n) => (
            <text
              fg={
                n().tone === "error"
                  ? theme().error
                  : n().tone === "success"
                    ? theme().success
                    : theme().warning
              }
              wrapMode="none"
            >
              {truncate(n().text, bodyCols())}
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}

/** Everything about a shell, with the full command wrapped rather than cut. */
