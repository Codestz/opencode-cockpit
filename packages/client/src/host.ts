/**
 * What a Cockpit TUI bay needs from OpenCode, whichever OpenCode it is.
 *
 * OpenCode 2 replaced the plugin API (docs/opencode/v2.md). Rather than write every bay twice, a bay
 * talks to `Host` — exactly the ~30 calls the bays make, named the way v1 names them — and each
 * version supplies one: `fromV1(api)` wraps the v1 API almost as it is, `fromV2(ctx)` builds the same
 * shape on the v2 context. `dualTui` turns one bay into an entry both versions load: v1 calls
 * `tui(api)`, v2 calls `setup(ctx)`.
 *
 * Nothing of OpenCode is imported at runtime here, and nothing of OpenTUI but the two helpers the
 * v1 half already relied on: the v2 context is described by the structural types below.
 */

import type { TuiDialogSelectOption, TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { CliRenderer, KeyEvent } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { createComponent, createRoot, type JSX } from "solid-js"

type V1Layer = Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]
export type Layer = V1Layer
export type Theme = TuiThemeCurrent

/** A key the host saw, and the way to keep it from anything else. */
export interface InterceptContext {
  event: KeyEvent
  consume: (options?: { preventDefault?: boolean; stopPropagation?: boolean }) => void
}

export interface SelectOption<Value> {
  title: string
  value: Value
  description?: string
  footer?: string
  category?: string
  disabled?: boolean
}

/** Which slot a render goes into. The names are v1's; `fromV2` maps them onto v2's paths. */
export type SlotName = "app_bottom" | "sidebar_content" | "home_bottom" | "session_prompt_right"
export type SlotRender = (input?: { sessionID?: string }) => JSX.Element

export interface Host {
  /** Which OpenCode this is. Bays should rarely need it. */
  readonly version: 1 | 2
  readonly renderer: CliRenderer
  readonly theme: { readonly current: Theme }
  readonly state: {
    readonly path: { readonly directory: string; readonly worktree: string }
    readonly vcs: { readonly branch?: string; readonly default_branch?: string } | undefined
  }
  readonly route: { readonly current: { name: string; params?: Record<string, unknown> } }
  readonly kv: {
    get<T>(key: string, fallback: T): T
    set(key: string, value: unknown): void
  }
  readonly ui: {
    toast(options: {
      title?: string
      message: string
      variant?: "info" | "success" | "warning" | "error"
      duration?: number
    }): void
    readonly dialog: {
      replace(render: () => JSX.Element, onClose?: () => void): void
      clear(): void
      setSize(size: "medium" | "large" | "xlarge"): void
      readonly depth: number
    }
    select<Value>(options: {
      title: string
      placeholder?: string
      current?: Value
      options: SelectOption<Value>[]
    }): Promise<Value | undefined>
    /**
     * Text from the person. `rich` draws above the field where the host can (v1's component dialog);
     * elsewhere `description` says it in words.
     */
    prompt(options: {
      title: string
      description?: string
      rich?: () => JSX.Element
      placeholder?: string
      value?: string
    }): Promise<string | undefined>
    confirm(options: { title: string; message: string }): Promise<boolean>
  }
  readonly keymap: {
    /** A global layer, until the returned function disposes it. */
    registerLayer(layer: Layer): () => void
    /** A layer owned by the calling component, for as long as it is mounted. */
    useLayer(layer: () => Layer): void
    /** Every key before the keymap sees it; `consume` keeps it from everyone else. */
    intercept(handler: (context: InterceptContext) => void, options?: { priority?: number }): () => void
    /** The key a command is bound to, formatted for a hint. */
    shortcut(command: string): string
  }
  readonly slots: {
    register(input: { order?: number; slots: Partial<Record<SlotName, SlotRender>> }): void
  }
  readonly lifecycle: { onDispose(fn: () => void): void }
  /** Hands text to a conversation, as if the person had sent it. */
  promptSession(sessionID: string, text: string): Promise<void>
  /** The v1 API itself, for the calls that have no v2 equivalent. */
  readonly v1?: TuiPluginApi
  /** The v2 context itself, likewise. */
  readonly v2?: V2Context
}

/* ─── v1 ─────────────────────────────────────────────────────────────────────────────────────── */

export function fromV1(api: TuiPluginApi): Host {
  const pick = <Value>(
    options: Parameters<Host["ui"]["select"]>[0] & { options: SelectOption<Value>[] },
  ): Promise<Value | undefined> =>
    new Promise((resolve) => {
      let done = false
      const finish = (value: Value | undefined) => {
        if (done) return
        done = true
        resolve(value)
      }
      api.ui.dialog.replace(
        () =>
          createComponent(
            api.ui.DialogSelect as (props: never) => JSX.Element,
            {
              title: options.title,
              ...(options.placeholder ? { placeholder: options.placeholder } : {}),
              ...(options.current !== undefined ? { current: options.current } : {}),
              options: options.options as TuiDialogSelectOption<Value>[],
              /** Answer first: clearing fires the close handler, which would settle it as cancelled. */
              onSelect: (option: TuiDialogSelectOption<Value>) => {
                finish(option.value)
                api.ui.dialog.clear()
              },
            } as never,
          ),
        () => finish(undefined),
      )
    })

  return {
    version: 1,
    renderer: api.renderer as CliRenderer,
    theme: api.theme,
    state: api.state as Host["state"],
    route: api.route as Host["route"],
    kv: api.kv as Host["kv"],
    ui: {
      toast: (options) => api.ui.toast(options),
      dialog: api.ui.dialog,
      select: pick,
      prompt: (options) =>
        new Promise((resolve) => {
          api.ui.dialog.replace(
            () =>
              createComponent(
                api.ui.DialogPrompt as (props: never) => JSX.Element,
                {
                  title: options.title,
                  ...(options.rich
                    ? { description: options.rich }
                    : options.description
                      ? { description: () => options.description }
                      : {}),
                  placeholder: options.placeholder ?? "",
                  value: options.value ?? "",
                  /** Answer first: clearing fires the close handler, which would settle it as cancelled. */
                  onConfirm: (text: string) => {
                    resolve(text)
                    api.ui.dialog.clear()
                  },
                  onCancel: () => {
                    resolve(undefined)
                    api.ui.dialog.clear()
                  },
                } as never,
              ),
            () => resolve(undefined),
          )
        }),
      confirm: (options) =>
        new Promise((resolve) => {
          api.ui.dialog.replace(
            () =>
              createComponent(
                api.ui.DialogConfirm as (props: never) => JSX.Element,
                {
                  title: options.title,
                  message: options.message,
                  onConfirm: () => {
                    resolve(true)
                    api.ui.dialog.clear()
                  },
                  onCancel: () => {
                    resolve(false)
                    api.ui.dialog.clear()
                  },
                } as never,
              ),
            () => resolve(false),
          )
        }),
    },
    keymap: {
      registerLayer: (layer) => api.keymap.registerLayer(layer),
      useLayer: (layer) => useBindings(layer as never),
      intercept: (handler, options) => api.keymap.intercept("key", handler as never, options),
      shortcut: (command) => {
        const bindings = api.keymap.getCommandBindings({ visibility: "registered", commands: [command] })
        return api.keys.formatBindings(bindings.get(command)) ?? ""
      },
    },
    slots: { register: (input) => api.slots.register(input as never) },
    lifecycle: api.lifecycle,
    promptSession: async (sessionID, text) => {
      await api.client.session.promptAsync({ sessionID, parts: [{ type: "text", text }] })
    },
    v1: api,
  }
}

/* ─── v2 ─────────────────────────────────────────────────────────────────────────────────────── */

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
      prompt?(input: unknown): Promise<unknown>
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
    readonly router: { current(): { type: string; sessionID?: string } }
    slot(claim: { render: (input: never) => JSX.Element } & Record<string, unknown>): () => void
  }
}

type Colour = TuiThemeCurrent["text"]
interface V2Theme {
  text: {
    base: Colour
    muted: Colour
    action: { primary: Colour; secondary: Colour }
    feedback: { error: Colour; warning: Colour; success: Colour; info: Colour }
  }
  background: { base: Colour; raised: { base: Colour; high: Colour; max: Colour } }
  border: { base: Colour }
  diff: {
    text: { added: Colour; removed: Colour; context: Colour; hunkHeader: Colour }
    background: { added: Colour; removed: Colour; context: Colour }
    highlight: { added: Colour; removed: Colour }
    lineNumber: { text: Colour; background: Colour }
  }
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
export function themeFromV2(theme: () => V2Theme): Theme {
  const map: Record<string, (t: V2Theme) => Colour> = {
    text: (t) => t.text.base,
    textMuted: (t) => t.text.muted,
    primary: (t) => t.text.action.primary,
    secondary: (t) => t.text.action.secondary,
    accent: (t) => t.text.action.primary,
    error: (t) => t.text.feedback.error,
    warning: (t) => t.text.feedback.warning,
    success: (t) => t.text.feedback.success,
    info: (t) => t.text.feedback.info,
    background: (t) => t.background.base,
    backgroundPanel: (t) => t.background.raised.base,
    backgroundElement: (t) => t.background.raised.high,
    backgroundMenu: (t) => t.background.raised.high,
    border: (t) => t.border.base,
    borderSubtle: (t) => t.border.base,
    borderActive: (t) => t.text.action.primary,
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
    diffAddedLineNumberBg: (t) => t.diff.highlight.added,
    diffRemovedLineNumberBg: (t) => t.diff.highlight.removed,
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
  return new Proxy({} as Theme, {
    get: (_target, key) => {
      if (typeof key !== "string") return undefined
      const read = map[key]
      if (read) return read(theme())
      /** markdownText, markdownHeading…: v2 keeps them under `markdown`. */
      if (key.startsWith("markdown")) {
        const name = key.slice(8, 9).toLowerCase() + key.slice(9)
        return theme().markdown[name] ?? theme().text.base
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
        ...(command.category ? { group: command.category } : {}),
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

export function fromV2(ctx: V2Context, onCleanup: (fn: () => void) => void): Host {
  const location = () => ctx.location ?? ctx.data.location.default()
  void ctx.data.location.vcs.sync(location()).catch(() => {})
  const [values, update] = ctx.storage.store<{ values: Record<string, unknown> }>("cockpit", {
    initial: { values: {} },
  })
  let depth = 0

  /** v2 owns layers through the component that creates them: a root stands in, so it can be disposed. */
  const ownedLayer = (layer: Layer): (() => void) =>
    createRoot((dispose: () => void) => {
      ctx.keymap.layer(() => layerToV2(layer))
      return dispose
    })

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
    promptSession: async (sessionID, text) => {
      await ctx.data.session.prompt?.({ sessionID, text })
    },
    v2: ctx,
  }
}

/* ─── one entry, both versions ───────────────────────────────────────────────────────────────── */

export type Start = (host: Host, options: Record<string, unknown> | undefined) => Promise<void> | void

/**
 * A TUI entry both OpenCodes load: v1 calls `tui(api, options)`, v2 calls `setup(ctx)` and runs the
 * returned cleanup when it unloads the plugin.
 */
export function dualTui(id: string, start: Start) {
  return {
    id,
    tui: async (api: TuiPluginApi, options?: unknown) => {
      await start(fromV1(api), options as Record<string, unknown> | undefined)
    },
    setup: async (ctx: V2Context) => {
      const cleanups: (() => void)[] = []
      await start(
        fromV2(ctx, (fn) => cleanups.push(fn)),
        ctx.options as Record<string, unknown>,
      )
      return () => {
        for (const fn of cleanups.reverse()) {
          try {
            fn()
          } catch {
            // one bay's cleanup failing must not keep the others from running
          }
        }
      }
    },
  }
}
