/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { LogLine, ShellInfo } from "@opencode-cockpit/protocol/shell"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { Badge } from "./badge.tsx"
import { isReleaseKey, keyToBytes } from "./keys.ts"
import { type ShellStore, useScreen } from "./store.ts"
import {
  displayCommand,
  kindColor,
  kindOf,
  relativeCwd,
  statusDetail,
  tailLines,
  truncate,
  wrapText,
} from "./view.ts"

export interface ConsoleProps {
  api: TuiPluginApi
  store: ShellStore
  /** Start in typing mode. */
  typing?: boolean
  onClose: () => void
  onNewShell: () => void
}

type View = "screen" | "log" | "details"
type Notice = { text: string; tone: "info" | "success" | "error" }

/** Daemon errors name ids and internal states; say what happened instead. */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/is (exited|killed|failed)$/.test(message)) return "the shell is no longer running"
  if (/not found$/.test(message)) return "that shell was already removed"
  if (/connection|not running|did not start/.test(message)) return "lost connection to cockpitd, retrying"
  return message
}
const COMMAND_LINES = 3

/**
 * Keyboard-first shell console in an overlay. Normal mode: single-key actions. Typing mode:
 * every key goes to the program (ctrl+c included); ctrl+] returns to normal mode.
 */
export function Console(props: ConsoleProps) {
  const theme = () => props.api.theme.current
  const dims = useTerminalDimensions()
  const shell = () => props.store.selected()
  const [view, setView] = createSignal<View>("screen")
  const [typing, setTyping] = createSignal(props.typing ?? false)
  const [log, setLog] = createSignal<LogLine[]>([])
  const [notice, setNotice] = createSignal<Notice>()
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
    if (!s || !s.summary) return undefined
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
    on([() => shell()?.id, view, () => screen()], () => {
      const id = shell()?.id
      if (!id || view() !== "log") return
      void client
        .call("shell.read", { id, tail: 2000, limit: 2000 })
        .then((page) => setLog(page.lines))
        .catch(() => {})
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
        run: () =>
          act("clear", async () => {
            const n = await props.store.clearFinished()
            return `cleared ${n} finished shell${n === 1 ? "" : "s"}`
          }),
      },
      { name: "cockpit.console.all", title: "Show all / fewer shells", run: () => props.store.toggleAll() },
      {
        name: "cockpit.console.view",
        title: "Toggle screen/log",
        run: () => setView((v) => (v === "log" ? "screen" : "log")),
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
      { name: "cockpit.console.close", title: "Close console", run: () => props.onClose() },
    ],
    bindings: [
      { key: "i,return", cmd: "cockpit.console.type", desc: "Type" },
      { key: "c", cmd: "cockpit.console.interrupt", desc: "^C" },
      { key: "r", cmd: "cockpit.console.restart", desc: "Restart" },
      { key: "x", cmd: "cockpit.console.stop", desc: "Stop" },
      { key: "d", cmd: "cockpit.console.remove", desc: "Remove" },
      { key: "shift+d", cmd: "cockpit.console.clear", desc: "Clear finished" },
      { key: "a", cmd: "cockpit.console.all", desc: "All" },
      { key: "tab", cmd: "cockpit.console.view", desc: "Screen/log" },
      { key: "?,shift+/", cmd: "cockpit.console.details", desc: "Details" },
      { key: "],l,right", cmd: "cockpit.console.next", desc: "Next" },
      { key: "[,h,left", cmd: "cockpit.console.prev", desc: "Prev" },
      { key: "n", cmd: "cockpit.console.new", desc: "New" },
      { key: "j,down", cmd: "cockpit.console.down", desc: "Down" },
      { key: "k,up", cmd: "cockpit.console.up", desc: "Up" },
      { key: "shift+g,end", cmd: "cockpit.console.bottom", desc: "End" },
      { key: "g,home", cmd: "cockpit.console.top", desc: "Top" },
      { key: "q", cmd: "cockpit.console.close", desc: "Close" },
    ],
  }))

  const screenText = createMemo(() => tailLines(screen()?.text, bodyRows(), bodyCols()))
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
  const position = createMemo(() => {
    const list = props.store.visible()
    const index = list.findIndex((x) => x.id === shell()?.id)
    const hidden = props.store.hidden().length
    return list.length > 1 || hidden > 0 ? `${index + 1}/${list.length}${hidden ? ` +${hidden}` : ""}` : ""
  })
  // Only the keys that do something for the selected shell.
  const hint = createMemo(() => {
    if (typing()) return "TYPING: keys go to the shell (ctrl+c included) · ctrl+] stop typing"
    const next = view() === "log" ? "screen" : "log"
    const wide = dims().width >= 110
    const live = running()
      ? wide
        ? ["i type", "c ^C", "r restart", "x stop"]
        : ["i type", "c ^C", "r", "x"]
      : [wide ? "r run again" : "r rerun", wide ? "d remove" : "d"]
    const common = wide
      ? [`tab ${next}`, "? details", "[ ] switch", "D clear done", "a all", "esc"]
      : [`tab ${next}`, "?", "[ ]", "D", "a", "esc"]
    return [...(shell() ? live : ["n new"]), ...common].join(" · ")
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
                <text fg={theme().text} wrapMode="none">
                  {screenText() || " "}
                </text>
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
                        {truncate(line.text, bodyCols() - 7)}
                      </text>
                    )}
                  </For>
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
function detailRows(s: ShellInfo, now: number, cols: number): [string, string][] {
  const width = Math.max(10, cols - 11)
  const rows: [string, string][] = []
  for (const [i, line] of wrapText(displayCommand(s), width, 12).entries())
    rows.push([i === 0 ? "command" : "", line])
  rows.push(["folder", s.cwd])
  rows.push([
    "status",
    `${s.status}${s.exitCode !== undefined ? ` (exit ${s.exitCode})` : ""}${s.signal ? ` (${s.signal})` : ""}`,
  ])
  rows.push(["timing", statusDetail(s, now)])
  rows.push(["started", new Date(s.startedAt).toLocaleString()])
  if (s.summary) rows.push(["summary", truncate(s.summary, width)])
  rows.push(["id", `${s.id} · run ${s.run}${s.pid ? ` · pid ${s.pid}` : ""}`])
  rows.push(["owner", s.owner.session ? `agent session ${s.owner.session}` : "you"])
  rows.push(["output", `${s.lines.last} lines · ${Math.round(s.bytes / 1024)} KiB`])
  return rows
}
