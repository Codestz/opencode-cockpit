---
name: status-setup
description: Set up or design the Status bay of opencode-cockpit (its statusline) with the user - the table in the sidebar or a line under the prompt, which segments it shows, a preset, a shell command or Claude Code statusline script as a segment, or a TypeScript segment module. Use it whenever the user runs /status-setup, or asks to change what the statusline or the Status table shows, e.g. "put the statusline at the bottom", "show the model and cost", "use my Claude Code statusline", "make the status table shorter", "show git against the branch", "hide the write row", or edits the "status" section of config.json or .cockpit.json. For which Cockpit blocks show and in what order, use the cockpit-setup skill.
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

Names from before 0.9 are **not read**, so their values do nothing today: `"statusline"` →
`"status"`, a bay-level `maxRows` → `sidebarRows`, Status keys at the file's root → under
`"status"`, a `sidebarOrder` → removed (the order is the top-level `"sidebar"` list). Fix them, and
every other notice, in the file each names; keep everything else, and say what changed in one line
each.

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

### A row or two: `override`, never a copy of the list

To change, drop or swap a few rows, write **`override`**, keyed by segment name — every other row
keeps following the preset. **Do not copy the preset's list into `segments` to change one row**:
`segments` replaces the whole list, and the copy stops following the preset. `false` drops a
segment, a name swaps it in place, an object merges into its settings:

| They say | Write |
| --- | --- |
| "show git against the branch, not uncommitted" | `{ "status": { "override": { "git": { "against": "branch" } } } }` |
| "hide the write row" | `{ "status": { "override": { "write": false } } }` |
| "show the working clock" | `{ "status": { "override": { "session.status": { "working": true } } } }` |
| "cost instead of spend" | `{ "status": { "override": { "spend": "cost" } } }` |
| "no hairlines" | `{ "status": { "override": { "sep": false } } }` |

Merge it into what is written: an existing `override` keeps its other keys, and `preset` stays as
it is. Write `segments` only to build a **different** line — a new order, rows the preset does not
have; with both written, `override` applies to `segments`. A name that matches no segment is a `!`
row naming the closest one.

Keys, every built-in segment, the presets, commands and modules are in
[references/settings.md](references/settings.md). Before you compose segments yourself, or write a
module, read [references/design.md](references/design.md): it holds the rules a good line follows,
learned the hard way, and they are not obvious.

## 5. Look at it before you write it

A statusline is judged in a terminal, not from a sentence. Use the preview that came with this
install: `cockpit_settings` prints its exact command under **Previews** (`bun "/…/dist/cli/preview.js"`)
— call it `<preview>` below. **Never run `bunx` or `npx @opencode-cockpit/status`**: they download the
newest published release, which may be older or newer than this install and read settings
differently (0.8 draws a bottom line at full width for a 0.9 sidebar config). If the tool lists no
preview, Status's agent side is not loaded: say so rather than reaching for `bunx`.

**Before writing**, pipe the whole file as it will be after your change — every key already in it,
plus the change — into the preview with `--config -`. **Do not write a temporary file**: one outside
the project asks the user for permission, and one inside it is a stray file in their repo. The
preview reads stdin through the same loader and resolution OpenCode uses (`preset`, `sidebarRows`,
`override`, the `!` rows), as the file it will become — `--as global` (the default) or `--as project`
— with the other file read beside it, as OpenCode will. Run it from the project folder, and show the
user the exact command you ran and what it drew:

```sh
cat <<'EOF' | <preview> --config - --state busy --debug
{ "status": { "preset": "sidebar", "override": { "git": { "against": "branch" } } } }
EOF
```

Then the same with `--state fresh`; `--as project` for a `.cockpit.json`; `--surface sidebar` (or
`bottom`) to force a surface.

- The first line names what it read: `config: (stdin, as ~/.config/opencode-cockpit/config.json)`.
  A `!` row is a notice to fix before writing.
- `--debug` names every row: `✓git` drew, `✗spend` ran and drew nothing (no data in that state),
  `?gti` is no segment at all (a typo).
- The sidebar is drawn 34 columns wide, as in OpenCode; `--width` changes it.
- An unknown flag or a file it cannot read stops it with an error: fix the command, do not guess.

Check `fresh` and `empty` (what a new session shows) and `full` (the widest numbers). For anything
custom, paste an ASCII mock and ask before writing it.

## 6. OpenCode's own sidebar blocks

These are OpenCode's settings in OpenCode's files: **ask first**, and keep everything else in the
file. `cockpit_settings` lists every block this version has, by its exact id, with its state now and
the exact edit — use those, never guess an id (`"-internal:sidebar-context"` does nothing on OpenCode 2).

| Block | OpenCode 1 (`tui.json` → `"plugin_enabled": { "<id>": false }`) | OpenCode 2 (`cli.json` → `"-<id>"` in `"plugins"`) | What to say |
| --- | --- | --- | --- |
| Context | `internal:sidebar-context` | `opencode.sidebar.context` | with the table in the sidebar it says the same thing above it: suggest turning it off |
| MCP | `internal:sidebar-mcp` | `opencode.sidebar.mcp` | optional, neutral: the table's `diagnostics` row already warns when a server fails; `opencode mcp list` shows them all |
| Footer | `internal:sidebar-footer` | `opencode.sidebar.footer` | optional, neutral: the project's path and git branch at the bottom of the sidebar |
| LSP | `internal:sidebar-lsp` | — | optional, neutral |
| Files | `internal:sidebar-files` | — | optional, neutral |
| Todo | `internal:sidebar-todo` | — | **never suggest turning it off**: nothing in Cockpit replaces it |

## 7. Write, verify, close

- Write JSONC into the `"status"` section of the file they chose: the global
  `~/.config/opencode-cockpit/config.json` by default, `<project>/.cockpit.json` for this project only.
  Only keys that differ from the defaults; keep comments and every other key. Write what you
  previewed, nothing else.
- Call `cockpit_settings` again: it must say `Notices: none` (a key Status does not read shows up
  there). A preset that does not exist, or an `override` name that matches no segment, is Status's own
  `!` row, and a segment name that does not exist draws nothing: `preview --config -` shows the one
  and `--debug` the other (`?name`), before a restart.
- Tell them what changed, that **it applies after restarting OpenCode**, and how to undo (remove
  those keys and restart; `/status-setup` again any time). For which blocks show and in what order,
  `/cockpit-setup`.
