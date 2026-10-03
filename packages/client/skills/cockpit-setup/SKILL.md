---
name: cockpit-setup
description: Set up opencode-cockpit ("Cockpit") with the user — which of its bays run, which show a block in OpenCode's sidebar, in what order, how quiet they are when empty — and fix settings from before 0.9. Use it whenever the user runs /cockpit-setup or asks to configure, tidy or change Cockpit or its sidebar, even in passing - "make my sidebar quieter", "hide the shells block when it's empty", "move trail above subagents", "turn subagents off", "show trust in the sidebar", "configure cockpit", or a question about ~/.config/opencode-cockpit/config.json or .cockpit.json. To design what the Status line itself shows, use the status-setup skill instead.
---

# Setting up Cockpit

Cockpit is a set of **bays** that add to OpenCode: `status` (a statusline table), `subagents`,
`shell` (background shells), `trail` (what a conversation made), `trust` (approvals it answers for
you), `review` (a changes pane) and `updater`. Most draw a block in the sidebar. Everything is set in
one JSONC file; your job is to write the smallest correct file for what the person wants, with them.

People run this once, or when something annoys them. Keep it short: fix what is broken, offer a
starting point, ask only what matters, write, verify.

## 1. Read the live state first

Call **`cockpit_settings`** before saying anything about the setup. It answers what is installed and
on, every value and where it came from, the sidebar order, the file paths, every setting that is not
read, and OpenCode's own sidebar blocks — for *this* install. Never guess any of that from memory or
from this skill: versions differ, and the tool reads the same files the bays do.

If the tool is not there, Cockpit's agent side is not loaded: say so, and point to
`npx opencode-cockpit@latest doctor`.

## 2. Fix the notices first

If the tool lists notices, fix them before anything else, in the file each one names: move the value
to the new name and remove the old key (an old order number is just removed — the order is the
top-level `sidebar` list). These names are **not read**, so the value under each is doing nothing
today. Tell the person what you changed in one line each, e.g. `"statusline" → "status"`. Keep their
comments and every other key.

## 3. Offer a starting point

Most people want a feel, not twenty keys. Offer these, with the one closest to their current file
pre-selected (no file at all: "Everything visible"). Each is the exact JSON to merge into the file;
keys already written that a preset does not mention stay as they are.

**Everything visible** — the defaults. Every installed block shows, with `none yet` while empty, so
you can see each bay is there. Nothing to write:

```json
{}
```

**Quiet** — blocks appear only when they have something to show, and list fewer rows:

```json
{
  "subagents": { "hideWhenEmpty": true, "sidebarRows": 4 },
  "shell": { "hideWhenEmpty": true, "sidebarRows": 3 },
  "trail": { "hideWhenEmpty": true, "sidebarRows": 3 }
}
```

**Minimal** — only Status and Trail in the sidebar. Subagents and Shell keep working (their panes,
commands and agent tools); only their blocks go:

```json
{
  "subagents": { "sidebar": false },
  "shell": { "sidebar": false },
  "trail": { "hideWhenEmpty": true }
}
```

**Classic** — Status as one line under the prompt instead of a table in the sidebar:

```json
{
  "status": { "sidebar": false }
}
```

Then ask whether they want to adjust anything. If not, go to step 5.

## 4. Ask only the questions that matter

One question at a time, each with the **current value pre-selected** (from `cockpit_settings`, which
shows the default when nothing is written). Skip anything already answered, and never ask about a
bay the tool says is not installed. If you have a `question` tool, use it for multiple choice, the
current value first and marked as current; otherwise ask in plain text with numbered options.

The two switches people mix up — say which one you mean:

- **`enabled: false`** turns a bay **off entirely**: no block, no commands, no agent tools.
- **`sidebar: false`** hides **only the block**. The bay keeps working.
- **`hideWhenEmpty: true`** keeps the block but draws nothing until there is something to list.

Useful questions, in this order, only where they apply:

1. Which bays they do not want at all → `enabled: false`.
2. When turning a bay **on**: "Show it in the sidebar?" with its default pre-selected (yes for all,
   except Trust: no).
3. Status in the sidebar (a table) or under the prompt (a line) → `status.sidebar`. What the line
   *shows* is the status-setup skill's job: offer it afterwards, do not design it here.
4. The order of the blocks, top to bottom → the top-level `"sidebar"` list. Only the bays they want to
   move need naming; the rest keep their default places after them.
5. For each block: shown with `none yet`, or hidden while empty (`hideWhenEmpty`); rows before it
   folds (`sidebarRows`).
6. Which file: the **global** one (every project, the default) or this project's `.cockpit.json`
   ("just this repo"). The project file wins key by key.

Keys, timers, guidance and anything else only if the person brings them up — every key, its type and
default is in [references/settings.md](references/settings.md). Read it before writing a key you
have not seen in the tool's answer.

## 5. OpenCode's own sidebar blocks

These are OpenCode's settings in OpenCode's files, so **ask before editing them**, and keep
everything else in the file. `cockpit_settings` says what each is set to now and gives the exact
edit for this version.

- **Context**: when Status draws its table in the sidebar, "Context" shows twice. Suggest turning
  OpenCode's off.
  - OpenCode 1, `tui.json`: `{ "plugin_enabled": { "internal:sidebar-context": false } }`
  - OpenCode 2, `cli.json`: add `"-opencode.sidebar.context"` to the `"plugins"` list, keeping the
    entries already there. (`"-internal:sidebar-context"` does nothing on OpenCode 2.)
- **LSP** (OpenCode 1 only, `internal:sidebar-lsp`): optional. Mention it, recommend neither way.
- **Todo**: **never suggest turning it off** — nothing in Cockpit replaces it. If the tool says it is
  off, offer to turn it back on.
- OpenCode 2 has no LSP or Todo block in the sidebar.

## 6. Write the file

- Write **JSONC** to the file they chose, creating it (and its folder) if needed: the global file by
  default, `<project>/.cockpit.json` for this project only. The tool gives both paths.
- Write **only keys that differ from the defaults**. A key set to its default is noise that hides the
  ones that matter, and freezes a default that a later release may improve.
- Merge into what is there: keep comments, keep keys you were not asked about.
- One section per bay (`"shell": { … }`); the order is the top-level `"sidebar"` list, never a key
  inside a bay.

## 7. Verify

Call `cockpit_settings` again. It must say **`Notices: none`**, and the bays must read the way the
person asked (on/off, block shown or hidden, the order). If a notice appears, you wrote something
the bays do not read: fix it and call again.

## 8. Close

Tell them, briefly:

- what changed, key by key, and in which file;
- **it applies after restarting OpenCode** — settings are read when it starts;
- how to undo: remove those keys (or the file) and restart; `/cockpit-setup` again any time;
- to design what the Status line shows, `/status-setup`.
