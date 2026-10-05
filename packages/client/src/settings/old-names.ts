/**
 * Old names: detection only, and removed in 0.10 — by deleting this file and its two calls in
 * `settings.ts` (`oldInSection`, `oldAtTop`).
 *
 * Before 0.9 each bay had its own spellings; they are no longer read, only recognised, so a config
 * written for 0.8 says what changed instead of silently doing nothing. Values under these keys are
 * ignored.
 */

import { type Bay, SETUP_COMMAND, type SettingsNotice } from "./index.ts"

/** Shell's keys that sat at the file's root before it had a section. */
const ROOT_SHELL = ["watch", "kinds", "defaults", "lifecycle", "notify", "guidance", "listRunningShells"]

/**
 * Root keys Status used to read as its own when the file had no section — so a root `enabled: false`
 * meant for something else turned the statusline off. A file's root is no bay's settings now.
 */
const ROOT_STATUS = [
  "enabled",
  "debug",
  "preset",
  "surface",
  "segments",
  "separator",
  "stack",
  "icons",
  "maxRows",
  "lines",
  "commands",
  "modules",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
]

/** Old keys inside a bay's section (and its plugin options), and what replaced them. */
const OLD_IN_SECTION: Readonly<Partial<Record<Bay, Readonly<Record<string, string>>>>> = {
  status: { maxRows: "sidebarRows" },
  shell: { historyMinutes: "hideFinishedAfterMinutes" },
  subagents: { hideFinishedAfter: "hideFinishedAfterMinutes", hideNestedAfter: "hideNestedAfterSeconds" },
}

/** Shell's old `ui` group: where each key went. Anything not listed went to `shell.<key>`. */
const OLD_UI: Readonly<Record<string, string>> = {
  historyMinutes: "shell.hideFinishedAfterMinutes",
  updateCheck: "updater.updateCheck",
  sidebarOrder: "sidebar",
}

/** Every old name the loader recognises, and what to write instead — for the `cockpit-setup` skill's reference. */
export const OLD_NAMES: readonly { old: string; new: string }[] = [
  { old: "statusline", new: "status" },
  { old: "status.maxRows", new: "status.sidebarRows" },
  ...ROOT_SHELL.map((key) => ({ old: key, new: `shell.${key}` })),
  { old: "ui.<key>", new: "shell.<key>" },
  { old: "ui.historyMinutes", new: "shell.hideFinishedAfterMinutes" },
  { old: "ui.updateCheck", new: "updater.updateCheck" },
  { old: "ui.sidebarOrder", new: "sidebar" },
  { old: "<bay>.sidebarOrder", new: "sidebar" },
  { old: "subagents.hideFinishedAfter", new: "subagents.hideFinishedAfterMinutes" },
  { old: "subagents.hideNestedAfter", new: "subagents.hideNestedAfterSeconds" },
]

const oldText = (old: string) => `"${old}" is no longer read — run ${SETUP_COMMAND}`

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Whether a key in one bay's section is an old name; when it is, it is noted. `prefix` is how a key is
 * named in a notice: `shell.` in a file, nothing in plugin options (where the keys are the bay's own).
 */
export function oldInSection(
  bay: Bay,
  key: string,
  value: unknown,
  file: string,
  prefix: string,
  notes: SettingsNotice[],
): boolean {
  const old = (name: string, now: string) =>
    notes.push({ bay, file, kind: "old", old: name, new: now, text: oldText(name) })
  const now = OLD_IN_SECTION[bay]?.[key]
  if (key === "sidebarOrder") old(`${prefix}${key}`, "sidebar")
  else if (now) old(`${prefix}${key}`, `${bay}.${now}`)
  else if (bay === "shell" && key === "ui" && isObject(value)) {
    for (const inner of Object.keys(value)) old(`${prefix}ui.${inner}`, OLD_UI[inner] ?? `shell.${inner}`)
  } else return false
  return true
}

/** Whether a key at a file's top level is an old name; when it is, it is noted. */
export function oldAtTop(
  key: string,
  value: unknown,
  note: (notice: Omit<SettingsNotice, "file">) => void,
): boolean {
  if (key === "statusline") {
    note({ bay: "status", kind: "old", old: key, new: "status", text: oldText(key) })
  } else if (ROOT_SHELL.includes(key)) {
    note({ bay: "shell", kind: "old", old: key, new: `shell.${key}`, text: oldText(key) })
  } else if (key === "ui" && isObject(value)) {
    for (const inner of Object.keys(value)) {
      const now = OLD_UI[inner] ?? `shell.${inner}`
      const bay = now.startsWith("updater.") ? "updater" : "shell"
      note({ bay, kind: "old", old: `ui.${inner}`, new: now, text: oldText(`ui.${inner}`) })
    }
  } else if (ROOT_STATUS.includes(key)) {
    note({
      bay: "status",
      kind: "unread",
      old: key,
      new: `status.${key}`,
      text: `"${key}" at the top level is not read: it belongs in "status"`,
    })
  } else return false
  return true
}
