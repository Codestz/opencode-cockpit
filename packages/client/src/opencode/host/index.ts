/**
 * What a Cockpit TUI bay needs from OpenCode, whichever OpenCode it is.
 *
 * OpenCode 2 replaced the plugin API (docs/opencode/v2.md). Rather than write every bay twice, a bay
 * talks to `Host` — exactly the ~30 calls the bays make, named the way v1 names them — and each
 * version supplies one: `fromV1(api)` wraps the v1 API almost as it is, `fromV2(ctx)` builds the same
 * shape on the v2 context. `dualTui` turns one bay into an entry both versions load: v1 calls
 * `tui(api)`, v2 calls `setup(ctx)`.
 *
 * Nothing of OpenCode is imported at runtime: the v2 context is described by structural types. Here
 * is the shape and the entry; `v1.ts` and `v2.ts` build it, `keymap.ts` has the key helpers.
 */

import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { CliRenderer, KeyEvent } from "@opentui/core"
import type { JSX } from "solid-js"
import { cockpitVersion, createLog, type Log } from "../../log.ts"
import { registerSetup } from "../../setup/palette.ts"
import { registerServiceCheck } from "../service.ts"
import { fromV1 } from "./v1.ts"
import { fromV2, type V2Context } from "./v2.ts"

export { type Binding, type BindingValue, bindingLookup } from "./keymap.ts"
export { fromV1, useApiLayer } from "./v1.ts"
export { fromV2, layerToV2, themeFromV2, type V2Context, v2Group } from "./v2.ts"

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
  /** The shared log (`cockpit.log`), scoped `tui`; a bay takes `log.child("shell")`. */
  readonly log: Log
  /** Hands text to a conversation, as if the person had sent it. */
  promptSession(sessionID: string, text: string): Promise<void>
  /** The v1 API itself, for the calls that have no v2 equivalent. */
  readonly v1?: TuiPluginApi
  /** The v2 context itself, likewise. */
  readonly v2?: V2Context
}

export type Start = (host: Host, options: Record<string, unknown> | undefined) => Promise<void> | void

/**
 * A TUI entry both OpenCodes load: v1 calls `tui(api, options)`, v2 calls `setup(ctx)` and runs the
 * returned cleanup when it unloads the plugin.
 */
export function dualTui(id: string, start: Start) {
  /**
   * What loaded, where, and anything that stopped it: written before the bay runs, so a bay that never
   * draws still says it was loaded and on which OpenCode, and one that throws leaves its stack.
   */
  const run = async (
    host: Host,
    options: Record<string, unknown> | undefined,
    opencode: string | undefined,
  ) => {
    host.log.info("start", {
      entry: id,
      opencode: host.version,
      opencodeVersion: opencode,
      cockpit: cockpitVersion(),
    })
    /** `/cockpit-setup`: every entry offers it, the first in a window registers it (setup/). */
    try {
      registerSetup(host, id)
    } catch (error) {
      host.log.warn("setup: not registered", { entry: id, error })
    }
    /** OpenCode 2: one toast when the background service still runs an older Cockpit (service.ts). */
    try {
      registerServiceCheck(host, id)
    } catch (error) {
      host.log.warn("service: not checked", { entry: id, error })
    }
    try {
      await start(host, options)
    } catch (error) {
      host.log.error("start failed", { entry: id, error })
      throw error
    }
  }
  return {
    id,
    tui: async (api: TuiPluginApi, options?: unknown) => {
      const host = fromV1(api, createLog("tui"))
      await run(host, options as Record<string, unknown> | undefined, api.app?.version)
    },
    setup: async (ctx: V2Context) => {
      const cleanups: (() => void)[] = []
      const host = fromV2(ctx, (fn) => cleanups.push(fn), createLog("tui"))
      await run(host, ctx.options as Record<string, unknown>, undefined)
      return () => {
        for (const fn of cleanups.reverse()) {
          try {
            fn()
          } catch (error) {
            // one bay's cleanup failing must not keep the others from running
            host.log.warn("cleanup failed", { entry: id, error })
          }
        }
      }
    },
  }
}

/**
 * Text pasted into the terminal (`ctrl+v`, `cmd+v`), for a surface with a text field of its own.
 *
 * A paste arrives as one `paste` event with the bytes, not as keys, so a field fed by `intercept`
 * never saw it — it went to OpenCode's prompt underneath instead. `handler` answers whether it took
 * the text; taken, nobody else gets it. Both OpenCodes hand over the same OpenTUI renderer.
 */
export function onPaste(host: Pick<Host, "renderer">, handler: (text: string) => boolean): () => void {
  const input = host.renderer.keyInput as unknown as {
    prependListener(event: "paste", fn: (event: PasteLike) => void): void
    off(event: "paste", fn: (event: PasteLike) => void): void
  }
  const decoder = new TextDecoder()
  const listener = (event: PasteLike) => {
    const text = event.text ?? (event.bytes ? decoder.decode(event.bytes) : "")
    if (!text || !handler(text)) return
    event.preventDefault?.()
    event.stopPropagation?.()
  }
  input.prependListener("paste", listener)
  return () => input.off("paste", listener)
}

interface PasteLike {
  bytes?: Uint8Array
  /** Older OpenTUI releases carried the text itself. */
  text?: string
  preventDefault?: () => void
  stopPropagation?: () => void
}
