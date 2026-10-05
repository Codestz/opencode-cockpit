/**
 * OpenCode 2's CLI plugin context as a `Host`: the same shape built on the v2 context, which is
 * described by the structural types here — nothing of OpenCode is imported at runtime.
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { CliRenderer, KeyEvent } from "@opentui/core"
import { createRoot, getOwner, type JSX, type Owner } from "solid-js"
import { type Log, silentLog } from "../../log.ts"
import type { Host, Layer, SelectOption, SlotName, SlotRender, Theme } from "./index.ts"

/** The parts of OpenCode 2's CLI plugin context used here (`@opencode/plugin/tui/context`). */
export interface V2Context {
  readonly options: Readonly<Record<string, unknown>>
  readonly location: { directory: string; project?: { directory?: string } } | undefined
  readonly renderer: CliRenderer
  readonly client: unknown
  readonly theme: V2Theme
  readonly data: {
    readonly location: {
      default(): { directory: string } | undefined
      readonly vcs: {
        sync(location?: unknown): Promise<void>
        info(location?: unknown): { branch?: { current?: string; default?: string } } | undefined
      }
      readonly model?: {
        list(location?: unknown): unknown[] | undefined
        sync(location?: unknown): Promise<void>
      }
      readonly mcp?: { readonly server: { list(location?: unknown): unknown[] | undefined } }
    }
    readonly session: {
      /**
       * A message to a conversation. `delivery` (2.0.18): `"steer"`, the default, hands it to the turn
       * that is running; `"queue"` waits for that turn to end.
       */
      prompt?(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<unknown>
      /** A new conversation, here unless `location` says otherwise; `request` settles once it exists. */
      create?(input: { location?: { directory: string }; title?: string }): {
        id: string
        request: Promise<unknown>
      }
      get?(sessionID: string): unknown
      status?(sessionID: string): unknown
      sync?(sessionID: string): Promise<void>
      readonly message?: { list(sessionID: string): unknown[]; sync(sessionID: string): Promise<void> }
    }
  }
  readonly keymap: {
    layer(input: () => V2Layer): void
    shortcuts(id: string): readonly string[]
  }
  readonly storage: {
    store<Value extends object>(
      key: string,
      options: { initial: Value },
    ): readonly [Value, (mutation: (draft: Value) => void) => Promise<void>]
  }
  readonly ui: {
    readonly dialog: {
      show(render: () => JSX.Element, onClose?: () => void): void
      set(options: { size?: "medium" | "large" | "xlarge"; centered?: boolean }): void
      clear(): void
      confirm(options: { title: string; message: string }): Promise<boolean | undefined>
      prompt(options: {
        title: string
        description?: string
        placeholder?: string
        value?: string
      }): Promise<string | undefined>
      select<Value>(options: {
        title: string
        placeholder?: string
        options: readonly SelectOption<Value>[]
        current?: Value
      }): Promise<Value | undefined>
    }
    readonly toast: {
      show(options: { title?: string; message: string; variant?: string; duration?: number }): void
    }
    readonly router: {
      current(): { type: string; sessionID?: string }
      /** Present on 2.0.18: `{ type: "session", sessionID }` or `{ type: "home" }`. */
      navigate?(route: { type: string; sessionID?: string }): void
    }
    slot(claim: { render: (input: never) => JSX.Element } & Record<string, unknown>): () => void
  }
}

type Colour = TuiThemeCurrent["text"]
type States = { base: Colour } & Record<string, unknown>
interface V2Theme {
  text: {
    base: Colour
    muted: Colour
    /** A colour per state (`base`, `hovered`, `focused`…), not a colour. */
    action: { primary: States; secondary: States }
    feedback: { error: States; warning: States; success: States; info: States }
  }
  background: { base: Colour; raised: { base: Colour; high: Colour; max: Colour } }
  border: { base: Colour }
  scrollbar?: { base: Colour }
  diff: {
    text: { added: Colour; removed: Colour; context: Colour; hunkHeader: Colour }
    background: { added: Colour; removed: Colour; context: Colour }
    highlight: { added: Colour; removed: Colour }
    lineNumber: { text: Colour; background: { added: Colour; removed: Colour } & Record<string, Colour> }
  }
  /** The palettes the tokens are built from: `hue.accent[200]`… Shades are relative to the mode. */
  hue?: Record<string, Record<string, Colour>>
  /** Which palette and shade a token was built from. */
  source?: (colour: Colour) => { hue: string; step: number | string } | undefined
  syntax: Record<
    | "comment"
    | "keyword"
    | "function"
    | "variable"
    | "string"
    | "number"
    | "type"
    | "operator"
    | "punctuation",
    Colour
  >
  markdown: Record<string, Colour>
}

interface V2Command {
  id?: string
  title?: string
  /** v1's `desc`: after the title in the palette, and the slash popup's text when there is one. */
  description?: string
  group?: string
  bind?: false | string
  palette?: true
  slash?: { name: string; aliases?: string[] }
  enabled?: boolean | (() => boolean)
  run: (input?: string, event?: KeyEvent) => void | false | Promise<void>
}
interface V2Layer {
  mode?: string
  enabled?: boolean | (() => boolean)
  priority?: number
  commands?: readonly V2Command[]
  bindings?: readonly string[]
}

/**
 * v2's token theme under v1's names, so every bay's colour table keeps working. Each read goes to
 * the live theme, so a theme switch is picked up on the next paint.
 */
/** An OpenTUI colour: v1's and v2's both keep their channels in a `buffer`. */
const isColour = (value: unknown): value is Colour =>
  typeof value === "object" && value !== null && "buffer" in value

export function themeFromV2(theme: () => V2Theme): Theme {
  /**
   * v2 has no token for v1's accent, primary or secondary: they are palettes (`hue.accent`,
   * `hue.interactive`, `hue.blue`), and the shade that reads as text is the one `text.base` is built
   * from — 200 in both dark and light mode, where shades count from the text's end. `text.action.*`
   * looked right and is not: it is the text *on* an action, white in the default theme, and took
   * every accent in Review and the key hints with it. Measured against 2.0.15's default theme in
   * both modes, next to v1 1.18.32's (docs/opencode/v2.md).
   */
  const palette = (t: V2Theme, hue: string, fallback: Colour | States) => {
    const step = t.source?.(t.text.base)?.step ?? 200
    return t.hue?.[hue]?.[String(step)] ?? fallback
  }
  const map: Record<string, (t: V2Theme) => Colour | States> = {
    text: (t) => t.text.base,
    textMuted: (t) => t.text.muted,
    primary: (t) => palette(t, "interactive", t.text.action.primary),
    secondary: (t) => palette(t, "blue", t.text.action.secondary),
    accent: (t) => palette(t, "accent", t.syntax.keyword),
    error: (t) => t.text.feedback.error,
    warning: (t) => t.text.feedback.warning,
    success: (t) => t.text.feedback.success,
    info: (t) => t.text.feedback.info,
    background: (t) => t.background.base,
    backgroundPanel: (t) => t.background.raised.base,
    backgroundElement: (t) => t.background.raised.high,
    backgroundMenu: (t) => t.background.raised.high,
    border: (t) => t.border.base,
    /** v1's subtle border has no v2 twin; the one border there is the nearest. */
    borderSubtle: (t) => t.border.base,
    /** Same grey as v1's in the default theme. */
    borderActive: (t) => t.scrollbar?.base ?? t.border.base,
    selectedListItemText: (t) => t.background.base,
    diffAdded: (t) => t.diff.text.added,
    diffRemoved: (t) => t.diff.text.removed,
    diffContext: (t) => t.diff.text.context,
    diffHunkHeader: (t) => t.diff.text.hunkHeader,
    diffHighlightAdded: (t) => t.diff.highlight.added,
    diffHighlightRemoved: (t) => t.diff.highlight.removed,
    diffAddedBg: (t) => t.diff.background.added,
    diffRemovedBg: (t) => t.diff.background.removed,
    diffContextBg: (t) => t.diff.background.context,
    diffLineNumber: (t) => t.diff.lineNumber.text,
    /** A tint, not the highlight: the highlight drew the gutter as a solid green or red block. */
    diffAddedLineNumberBg: (t) => t.diff.lineNumber.background.added,
    diffRemovedLineNumberBg: (t) => t.diff.lineNumber.background.removed,
    syntaxComment: (t) => t.syntax.comment,
    syntaxKeyword: (t) => t.syntax.keyword,
    syntaxFunction: (t) => t.syntax.function,
    syntaxVariable: (t) => t.syntax.variable,
    syntaxString: (t) => t.syntax.string,
    syntaxNumber: (t) => t.syntax.number,
    syntaxType: (t) => t.syntax.type,
    syntaxOperator: (t) => t.syntax.operator,
    syntaxPunctuation: (t) => t.syntax.punctuation,
  }
  /** v1's markdown names that v2 spells differently; the rest only lose the prefix. */
  const MARKDOWN: Record<string, string> = { markdownEmph: "emphasis" }
  /**
   * v2's action and feedback tokens are not colours but a colour per state — `{ base, hovered,
   * focused, … }` — and a bay handed one of those passed it on as a colour. `base` is the colour at
   * rest; anything else that is not a colour falls back to the text colour rather than breaking a
   * paint.
   */
  const colour = (value: unknown): Colour => {
    const found = isColour(value)
      ? value
      : isColour((value as { base?: unknown })?.base)
        ? (value as { base: Colour }).base
        : undefined
    return found ?? theme().text.base
  }
  return new Proxy({} as Theme, {
    get: (_target, key) => {
      if (typeof key !== "string") return undefined
      const read = map[key]
      if (read) return colour(read(theme()))
      /** markdownText, markdownHeading…: v2 keeps them under `markdown`. */
      if (key.startsWith("markdown")) {
        const name = MARKDOWN[key] ?? key.slice(8, 9).toLowerCase() + key.slice(9)
        return colour(theme().markdown[name])
      }
      return theme().text.base
    },
  })
}

/** v1 slot names onto v2's slot paths. */
const SLOT_PATHS: Record<SlotName, string> = {
  app_bottom: "app",
  sidebar_content: "sidebar.content",
  home_bottom: "home.footer.status",
  session_prompt_right: "prompt.footer.status",
}

/**
 * A palette group on v2: the bay alone, `Cockpit · Review` → `Review`.
 *
 * v1 draws the category as a heading over its commands and searches it, so `Cockpit · Review` there
 * is what makes "cockpit" find them all. v2 draws the group beside every row a search shows, with
 * the key after it, and the title gives up what they take: `Open or close the change Cockpit ·
 * Review · ctrl+x v`. It finds a command by its id as well (`cockpit.review.open`), so "cockpit"
 * finds them there without the prefix.
 */
export function v2Group(category: string): string {
  return category.replace(/^Cockpit · /, "")
}

/** A v1 layer — commands plus `{ key, cmd }` bindings — as a v2 layer. */
export function layerToV2(layer: Layer): V2Layer {
  const bindings = (layer.bindings ?? []) as readonly { key?: string; cmd?: unknown }[]
  const keysFor = (name: string) =>
    bindings
      .filter((binding) => binding.cmd === name && typeof binding.key === "string")
      .map((binding) => binding.key as string)
      .join(",")
  const commands = (layer.commands ?? []) as readonly {
    name: string
    title?: string
    /** Drawn after the title in the palette — and, on both versions, what the slash popup shows. */
    desc?: string
    category?: string
    namespace?: string
    slashName?: string
    enabled?: boolean | (() => boolean)
    run: (...args: never[]) => unknown
  }[]
  const enabled = (layer as { enabled?: boolean | (() => boolean) }).enabled
  return {
    mode: "global",
    ...(layer.priority !== undefined ? { priority: layer.priority } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    commands: commands.map((command) => {
      const keys = keysFor(command.name)
      return {
        id: command.name,
        ...(command.title ? { title: command.title } : {}),
        ...(command.desc ? { description: command.desc } : {}),
        ...(command.category ? { group: v2Group(command.category) } : {}),
        ...(command.namespace === "palette" ? { palette: true as const } : {}),
        ...(command.slashName ? { slash: { name: command.slashName } } : {}),
        ...(command.enabled !== undefined ? { enabled: command.enabled } : {}),
        bind: keys || false,
        run: () => {
          command.run()
        },
      }
    }),
    bindings: commands.map((command) => command.name),
  }
}

export function fromV2(ctx: V2Context, onCleanup: (fn: () => void) => void, log: Log = silentLog): Host {
  const location = () => ctx.location ?? ctx.data.location.default()
  void ctx.data.location.vcs.sync(location()).catch(() => {})
  const [values, update] = ctx.storage.store<{ values: Record<string, unknown> }>("cockpit", {
    initial: { values: {} },
  })
  let depth = 0

  /**
   * v2 creates a key layer through the component that owns it, and finds the keymap in that
   * component's context — a layer made from `setup` fails with "Keymap.Provider is missing". So one
   * invisible claim on the `app` slot is mounted, its owner kept, and every global layer is made in
   * a root of its own under it: disposable on its own, and inside the host's context. Layers asked
   * for before that component has rendered wait for it.
   */
  let keyOwner: Owner | undefined
  const waiting: (() => void)[] = []
  onCleanup(
    ctx.ui.slot({
      append: "app",
      render: () => {
        keyOwner = getOwner() ?? undefined
        for (const start of waiting.splice(0)) start()
        return null as unknown as JSX.Element
      },
    }),
  )
  const ownedLayer = (layer: Layer): (() => void) => {
    let dispose: (() => void) | undefined
    let gone = false
    const start = () => {
      if (gone) return
      dispose = createRoot((done: () => void) => {
        ctx.keymap.layer(() => layerToV2(layer))
        return done
      }, keyOwner)
    }
    if (keyOwner) start()
    else waiting.push(start)
    return () => {
      gone = true
      dispose?.()
    }
  }

  return {
    version: 2,
    renderer: ctx.renderer,
    theme: { current: themeFromV2(() => ctx.theme) },
    state: {
      get path() {
        const directory = location()?.directory ?? process.cwd()
        return { directory, worktree: directory }
      },
      get vcs() {
        const branch = ctx.data.location.vcs.info(location())?.branch
        return branch ? { branch: branch.current, default_branch: branch.default } : undefined
      },
    },
    route: {
      get current() {
        const route = ctx.ui.router.current()
        return route.type === "session"
          ? { name: "session", params: { sessionID: route.sessionID } }
          : { name: route.type }
      },
    },
    kv: {
      get: <T>(key: string, fallback: T): T => (key in values.values ? (values.values[key] as T) : fallback),
      set: (key, value) => {
        void update((draft) => {
          draft.values[key] = value
        })
      },
    },
    ui: {
      toast: (options) => ctx.ui.toast.show(options),
      dialog: {
        replace: (render, onClose) => {
          depth = 1
          ctx.ui.dialog.show(render, () => {
            depth = 0
            onClose?.()
          })
        },
        clear: () => {
          depth = 0
          ctx.ui.dialog.clear()
        },
        setSize: (size) => ctx.ui.dialog.set({ size }),
        get depth() {
          return depth
        },
      },
      select: (options) => ctx.ui.dialog.select(options),
      prompt: ({ rich: _rich, ...options }) => ctx.ui.dialog.prompt(options),
      confirm: async (options) => (await ctx.ui.dialog.confirm(options)) === true,
    },
    keymap: {
      registerLayer: ownedLayer,
      useLayer: (layer) => ctx.keymap.layer(() => layerToV2(layer())),
      intercept: (handler) => {
        /** v2 has no intercept: the renderer's own key stream, ahead of every other listener. */
        const input = ctx.renderer.keyInput as unknown as {
          prependListener(event: string, fn: (event: KeyEvent) => void): void
          off(event: string, fn: (event: KeyEvent) => void): void
        }
        const listener = (event: KeyEvent) =>
          handler({
            event,
            consume: () => {
              event.preventDefault()
              event.stopPropagation?.()
            },
          })
        input.prependListener("keypress", listener)
        return () => input.off("keypress", listener)
      },
      shortcut: (command) => ctx.keymap.shortcuts(command)[0] ?? "",
    },
    slots: {
      register: ({ slots }) => {
        for (const [name, render] of Object.entries(slots) as [SlotName, SlotRender][]) {
          const path = SLOT_PATHS[name]
          if (!path || !render) continue
          onCleanup(ctx.ui.slot({ append: path, render: render as never }))
        }
      },
    },
    lifecycle: { onDispose: onCleanup },
    log,
    promptSession: async (sessionID, text) => {
      await ctx.data.session.prompt?.({ sessionID, text })
    },
    v2: ctx,
  }
}
