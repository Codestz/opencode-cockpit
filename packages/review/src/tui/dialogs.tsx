/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

/**
 * Writing a note.
 *
 * The host's own prompt dialog, rather than a text field of our own: it is the one surface OpenCode
 * focuses and re-renders without argument, it already handles editing and escape, and it looks like
 * everything else in the app. Shell reaches for the same thing for the same reason.
 */
export function askForNote(
  api: TuiPluginApi,
  { title, description, value }: { title: string; description: string; value?: string },
  onConfirm: (text: string) => void,
): void {
  const DialogPrompt = api.ui.DialogPrompt
  api.ui.dialog.replace(
    () => (
      <DialogPrompt
        title={title}
        description={() => <text>{description}</text>}
        placeholder="what should change, and why"
        value={value ?? ""}
        onConfirm={(text: string) => {
          api.ui.dialog.clear()
          const trimmed = text.trim()
          if (trimmed) onConfirm(trimmed)
        }}
        onCancel={() => api.ui.dialog.clear()}
      />
    ),
    () => {},
  )
}
