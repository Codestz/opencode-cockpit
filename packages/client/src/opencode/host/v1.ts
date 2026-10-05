/**
 * OpenCode 1's plugin API as a `Host`: wrapped almost as it is.
 */

import type { TuiDialogSelectOption, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { CliRenderer } from "@opentui/core"
import { createComponent, type JSX, onCleanup } from "solid-js"
import { type Log, silentLog } from "../../log.ts"
import { textElement } from "../elements.tsx"
import type { Host, Layer, SelectOption } from "./index.ts"

/** A v1 layer owned by the calling component: registered now, disposed when the component goes. */
export function useApiLayer(api: TuiPluginApi, layer: () => Layer): void {
  const dispose = api.keymap.registerLayer(layer())
  onCleanup(dispose)
}

export function fromV1(api: TuiPluginApi, log: Log = silentLog): Host {
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
                      ? { description: textElement(options.description) }
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
      useLayer: (layer) => useApiLayer(api, layer),
      intercept: (handler, options) => api.keymap.intercept("key", handler as never, options),
      shortcut: (command) => {
        const bindings = api.keymap.getCommandBindings({ visibility: "registered", commands: [command] })
        return api.keys.formatBindings(bindings.get(command)) ?? ""
      },
    },
    slots: { register: (input) => api.slots.register(input as never) },
    lifecycle: api.lifecycle,
    log,
    promptSession: async (sessionID, text) => {
      await api.client.session.promptAsync({ sessionID, parts: [{ type: "text", text }] })
    },
    v1: api,
  }
}
