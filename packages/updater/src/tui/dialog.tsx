/** @jsxImportSource @opentui/solid */

/**
 * `/plugins-update`: the list, the review, the result — the approved mock, drawn from the same rows
 * the CLI prints (https://claude.ai/artifact/H34qPDuKGKaEaG4SCunmbo).
 *
 * A dialog rather than a pane because a dialog is the one surface where plain letter keys can be
 * bound without taking them from the prompt (docs/opencode/plugin-api.md).
 */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { useBindings } from "@opentui/keymap/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { Readiness } from "../core/apply.ts"
import type { Gathered } from "../core/gather.ts"
import type { PluginPlan } from "../core/plan.ts"
import type { Outcome } from "../core/verify.ts"
import { keyRow, listRows, resultRows, reviewRows, titleRow } from "../core/view/layout.ts"
import { fit, type Row } from "../core/view/rows.ts"
import { Rows } from "./rows.tsx"

type Phase = "loading" | "list" | "review" | "applying" | "result"

export interface UpdaterDialogProps {
  api: TuiPluginApi
  home: string
  load(): Promise<Gathered>
  ready(): Promise<Readiness>
  apply(plan: PluginPlan, found: Gathered): Promise<Outcome>
  manualSteps(plans: readonly PluginPlan[]): string[]
  onClose(): void
}

export function UpdaterDialog(props: UpdaterDialogProps) {
  const theme = () => props.api.theme.current
  const dims = useTerminalDimensions()
  // The host's xlarge dialog is 116 columns, capped by the screen; its frame takes seven.
  const width = () => Math.max(40, Math.min(116, dims().width - 2) - 7)
  // Rows the list may use: the host puts the dialog a quarter of the way down, and below the list
  // sit our title, header, footer and gaps plus the host's own frame and status line.
  const room = () => Math.max(4, dims().height - Math.floor(dims().height / 4) - 14)

  const [phase, setPhase] = createSignal<Phase>("loading")
  const [found, setFound] = createSignal<Gathered>()
  const [cursor, setCursor] = createSignal(0)
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [outcomes, setOutcomes] = createSignal<Outcome[]>([])
  /** A sentence under the title: why nothing was written, what was copied. */
  const [notice, setNotice] = createSignal<{ text: string; tone: "muted" | "warning" | "removed" }>()

  /** What the cursor moves over: OpenCode's own parts are one summary line, not rows. */
  const plans = () => (found()?.plans ?? []).filter((p) => p.state !== "internal")
  const chosen = () => plans().filter((p) => selected().has(p.name))
  const actionable = (plan: PluginPlan | undefined) => plan?.state === "update" || plan?.state === "pin"

  void props
    .load()
    .then((result) => {
      setFound(result)
      setSelected(new Set(result.plans.filter((p) => p.selected).map((p) => p.name)))
      const first = result.warnings[0] ?? result.errors[0]?.message
      if (first) setNotice({ text: first, tone: "warning" })
      setPhase("list")
    })
    .catch((err) => {
      setNotice({ text: String(err), tone: "removed" })
      setPhase("list")
    })

  const move = (by: number) => setCursor((i) => Math.max(0, Math.min(plans().length - 1, i + by)))
  const toggle = () => {
    const plan = plans()[cursor()]
    if (!actionable(plan) || !plan) return
    const next = new Set(selected())
    if (next.has(plan.name)) next.delete(plan.name)
    else next.add(plan.name)
    setSelected(next)
  }
  const selectAll = () =>
    setSelected(
      new Set(
        plans()
          .filter((p) => actionable(p))
          .map((p) => p.name),
      ),
    )

  const run = async (targets: readonly PluginPlan[]) => {
    const result = found()
    if (!result || targets.length === 0) return
    const ready = await props.ready()
    if (ready !== "ready") {
      // Nothing may be run for them, so say exactly what to run; `c` copies it.
      setNotice({
        text:
          ready === "missing"
            ? "Could not run opencode, so nothing was written. c copies the steps."
            : "This OpenCode's plugin command has no --force, so nothing was written. c copies the steps.",
        tone: "warning",
      })
      setOutcomes(
        targets.map((plan) => ({
          name: plan.name,
          ok: false,
          confirmed: [],
          problems: ["not updated"],
          fixes: props.manualSteps([plan]),
        })),
      )
      setPhase("result")
      return
    }
    setPhase("applying")
    const done: Outcome[] = []
    for (const plan of targets) {
      done.push(await props.apply(plan, result))
      setOutcomes([...done])
    }
    setNotice(undefined)
    setPhase("result")
  }

  const next = () => {
    if (phase() === "list" && chosen().length > 0) setPhase("review")
    else if (phase() === "review") void run(chosen())
  }
  const retry = () => {
    const failed = new Set(
      outcomes()
        .filter((o) => !o.ok)
        .map((o) => o.name),
    )
    if (failed.size === 0) return
    setSelected(failed)
    setPhase("review")
  }
  const copy = () => {
    const fixes = outcomes().flatMap((o) => o.fixes)
    if (fixes.length === 0) return
    const ok = props.api.renderer.copyToClipboardOSC52(fixes.join("\n"))
    setNotice(
      ok
        ? { text: `Copied ${fixes.length} line${fixes.length === 1 ? "" : "s"}.`, tone: "muted" }
        : { text: "This terminal refused the clipboard.", tone: "warning" },
    )
  }

  // Escape goes back a step from the review, and is held while writing: closing halfway would hide
  // a result that still has to be read. Everywhere else the host closes the dialog as usual.
  const release = props.api.keymap.intercept(
    "key",
    (ctx) => {
      if (ctx.event.name !== "escape") return
      if (phase() === "review") {
        ctx.consume({ preventDefault: true, stopPropagation: true })
        setPhase("list")
      } else if (phase() === "applying") {
        ctx.consume({ preventDefault: true, stopPropagation: true })
      }
    },
    { priority: 10_000 },
  )
  onCleanup(release)

  useBindings(() => ({
    commands: [
      { name: "cockpit.updater.down", title: "Next plugin", run: () => phase() === "list" && move(1) },
      { name: "cockpit.updater.up", title: "Previous plugin", run: () => phase() === "list" && move(-1) },
      { name: "cockpit.updater.toggle", title: "Select plugin", run: () => phase() === "list" && toggle() },
      {
        name: "cockpit.updater.all",
        title: "Select every update",
        run: () => phase() === "list" && selectAll(),
      },
      { name: "cockpit.updater.next", title: "Review / apply", run: () => next() },
      { name: "cockpit.updater.retry", title: "Retry failed", run: () => phase() === "result" && retry() },
      { name: "cockpit.updater.copy", title: "Copy fix", run: () => phase() === "result" && copy() },
    ],
    bindings: [
      { key: "j,down", cmd: "cockpit.updater.down", desc: "Next" },
      { key: "k,up", cmd: "cockpit.updater.up", desc: "Previous" },
      { key: "space", cmd: "cockpit.updater.toggle", desc: "Select" },
      { key: "a", cmd: "cockpit.updater.all", desc: "All updates" },
      { key: "return", cmd: "cockpit.updater.next", desc: "Review" },
      { key: "r", cmd: "cockpit.updater.retry", desc: "Retry failed" },
      { key: "c", cmd: "cockpit.updater.copy", desc: "Copy fix" },
    ],
  }))

  const rows = createMemo((): Row[] => {
    const w = width()
    const out: Row[] = []
    const n = chosen().length
    const plural = (k: number) => `${k} plugin${k === 1 ? "" : "s"}`
    switch (phase()) {
      case "loading":
        out.push(titleRow("Plugins", "esc", w), { runs: fit([], w) })
        out.push({
          runs: fit([{ text: "Checking what is installed and what is published…", tone: "muted" }], w),
        })
        break
      case "list": {
        out.push(titleRow("Plugins", "esc", w), { runs: fit([], w) })
        const all = listRows(found()?.plans ?? [], w, { cursor: cursor(), selected: selected() })
        const [header, ...body] = all
        // Keep the cursor in view without drawing more rows than fit.
        const start = Math.max(0, Math.min(cursor() - room() + 2, body.length - room()))
        if (header) out.push(header)
        out.push(...body.slice(start, start + room()))
        if (plans().length === 0)
          out.push({ runs: fit([{ text: "No plugins in your OpenCode config.", tone: "muted" }], w) })
        break
      }
      case "review":
        out.push(titleRow(`Update ${plural(n)}`, "nothing written yet", w), { runs: fit([], w) })
        out.push(...reviewRows(chosen(), w, props.home))
        break
      case "applying":
        out.push(titleRow(`Updating ${plural(n)}`, `${outcomes().length} of ${n}`, w), { runs: fit([], w) })
        out.push(...resultRows(chosen(), outcomes(), w))
        out.push({
          runs: fit([{ text: "Running opencode plugin… this installs from npm.", tone: "muted" }], w),
        })
        break
      case "result": {
        const ok = outcomes().filter((o) => o.ok).length
        out.push(titleRow(`Updated ${ok} of ${outcomes().length}`, "checked against disk", w), {
          runs: fit([], w),
        })
        out.push(...resultRows(chosen(), outcomes(), w))
        break
      }
    }
    return out
  })

  /** Always two rows, whatever they say, so the body above never jumps (docs/building/terminal-ui.md). */
  const footer = createMemo((): Row[] => {
    const w = width()
    const note = notice()
    const selectedCount = chosen().length
    const first: Row = note
      ? { runs: fit([{ text: note.text, tone: note.tone }], w) }
      : phase() === "list"
        ? {
            runs: fit(
              [
                {
                  text: !plans().some((p) => actionable(p))
                    ? "Nothing to update."
                    : `${selectedCount} selected${plans().some((p) => p.frozen && actionable(p)) ? "  ·  ⚠ a spec that will not move on its own" : ""}`,
                  tone: "muted",
                },
              ],
              w,
            ),
          }
        : phase() === "result" && outcomes().some((o) => o.ok)
          ? { runs: fit([{ text: "Restart OpenCode to load what was updated." }], w) }
          : { runs: fit([], w) }
    const keys: (readonly [string, string])[] =
      phase() === "list"
        ? [
            ["space", "Select"],
            ["a", "All updates"],
            ["enter", "Review"],
            ["esc", "Close"],
          ]
        : phase() === "review"
          ? [
              ["enter", "Apply"],
              ["esc", "Back"],
            ]
          : phase() === "result"
            ? [
                ...(outcomes().some((o) => !o.ok)
                  ? [["r", "Retry failed"] as const, ["c", "Copy fix"] as const]
                  : []),
                ["esc", "Close"] as const,
              ]
            : []
    return [first, keyRow(keys, w)]
  })

  return (
    <box flexDirection="column" gap={1} paddingLeft={1}>
      <Rows theme={theme} rows={rows} />
      <Rows theme={theme} rows={footer} />
    </box>
  )
}
