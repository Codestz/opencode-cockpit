---
name: status-setup
description: Set up or design the Status bay of opencode-cockpit (its statusline) with the user - the table in the sidebar or a line under the prompt, which segments it shows, a preset, a shell command or Claude Code statusline script as a segment, or a TypeScript segment module. Use it whenever the user runs /status-setup or /statusline, or asks to change what the statusline or the Status table shows, e.g. "put the statusline at the bottom", "show the model and cost", "use my Claude Code statusline", "make the status table shorter", or edits the "status" section of config.json or .cockpit.json. For which Cockpit blocks show and in what order, use the cockpit-setup skill.
---

# Setting up the Status bay

Status is Cockpit's statusline. By default it is a **table in the sidebar** (context bar, tokens,
spend, git); it can instead be **one line under the prompt**. It is set in the `"status"` section of
Cockpit's settings file. Most people want a good line, not a design exercise: start from a preset,
change only what they ask for, and look at the result before calling it done.

## 1. Read the live state first

Call **`cockpit_settings`**. Its `status` entry says whether Status is on, where it draws, every
`status` value and where it came from, and the file paths; its notices say what is not read. Do not
guess any of that from memory.

## 2. Fix the notices first

Old names are **not read**, so their values do nothing today: `"statusline"` → `"status"`, a
bay-level `maxRows` → `sidebarRows`, Status keys at the file's root → under `"status"`, a
`sidebarOrder` → removed (the order is the top-level `"sidebar"` list). Fix them in the file each
notice names, keep everything else, and say what changed in one line each.

## 3. Offer a starting point

Pre-select the one closest to what is written now (nothing written: the table). Each is the exact
`"status"` section to merge into the file:

**The table** — the default: the sidebar table. Nothing to write:

```json
{}
```

**One line** — under the prompt: the capacity bar, where the tokens went, what changed, how long:

```json
{ "status": { "sidebar": false } }
```

**Minimal line** — under the prompt, only how full the context is and what changed:

```json
{ "status": { "sidebar": false, "preset": "minimal" } }
```

**Detailed line** — under the prompt, everything the built-ins know, for a wide window:

```json
{ "status": { "sidebar": false, "preset": "detailed" } }
```

**My Claude Code statusline** — the script they already have, unchanged, as a line under the prompt
(ask for its path and put it in `run`):

```json
{
  "status": {
    "sidebar": false,
    "segments": [{ "type": "command", "name": "claude" }],
    "commands": { "claude": { "run": "~/.claude/statusline.sh" } }
  }
}
```

## 4. Ask only what matters

One question at a time, the current value pre-selected. If you have a `question` tool, use it for
multiple choice; otherwise ask in plain text with numbered options.

- Sidebar table or a line under the prompt (`"sidebar": false` puts it at the bottom).
- What to add or drop, in their words ("show the model", "no git") — then map it to segments.
- In the sidebar: how many rows before the rest fold (`sidebarRows`; 14 with the table).
- Icons on or off (`icons`), only if their terminal shows boxes or gaps.

Keys, every built-in segment, the presets, commands and modules are in
[references/settings.md](references/settings.md). Before you compose segments yourself, or write a
module, read [references/design.md](references/design.md): it holds the rules a good line follows,
learned the hard way, and they are not obvious.

## 5. Look at it before you call it done

A statusline is judged in a terminal, not from a sentence. After any change to segments:

```sh
bunx @opencode-cockpit/status preview --watch     # redraws on every save
bunx @opencode-cockpit/status preview --debug     # marks segments that drew nothing
bunx @opencode-cockpit/status preview --state fresh
```

Check `fresh` and `empty` (what a new session shows) and `full` (the widest numbers). For anything
custom, paste an ASCII mock and ask before writing it.

## 6. OpenCode's own Context block

With the table in the sidebar, OpenCode's own Context block says the same thing above it. Suggest
turning OpenCode's off — **ask first**, it is OpenCode's file, and keep everything else in it.
`cockpit_settings` gives the exact edit for this version:

- OpenCode 1, `tui.json`: `{ "plugin_enabled": { "internal:sidebar-context": false } }`
- OpenCode 2, `cli.json`: add `"-opencode.sidebar.context"` to the `"plugins"` list.

Never suggest turning OpenCode's Todo block off: nothing in Cockpit replaces it.

## 7. Write, verify, close

- Write JSONC into the `"status"` section of the file they chose: the global
  `~/.config/opencode-cockpit/config.json` by default, `<project>/.cockpit.json` for this project only.
  Only keys that differ from the defaults; keep comments and every other key.
- Call `cockpit_settings` again: it must say `Notices: none` (a key Status does not read shows up
  there). A preset that does not exist is Status's own `!` row, and a segment name that does not
  exist draws nothing: `preview` shows the one and `preview --debug` the other, before a restart.
- Tell them what changed, that **it applies after restarting OpenCode**, and how to undo (remove
  those keys and restart; `/status-setup` again any time). For which blocks show and in what order,
  `/cockpit-setup`.
