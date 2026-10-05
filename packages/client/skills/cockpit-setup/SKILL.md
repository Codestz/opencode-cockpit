---
name: cockpit-setup
description: Set up opencode-cockpit ("Cockpit") with the user — which of its bays run, which show a block in OpenCode's sidebar, in what order, how quiet they are when empty — fix settings it cannot read, and, when they want it, tune Cockpit to how they work (a tour of its keys and the project's conventions (dev server, ticket keys) written to AGENTS.md). Use it whenever the user runs /cockpit-setup or asks to configure, tidy or change Cockpit or its sidebar, even in passing - "make my sidebar quieter", "hide the shells block when it's empty", "move trail above subagents", "turn subagents off", "show trust in the sidebar", "configure cockpit", "tell cockpit our dev server is bun dev", "our tickets are COM-…", or a question about ~/.config/opencode-cockpit/config.json or .cockpit.json. To design what the Status line itself shows, use the status-setup skill instead.
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

If the tool lists notices, fix them before anything else, in the file each one names. A key that is
not a setting is **not read**, so the value under it is doing nothing today: when the notice says
what was meant (`did you mean "status"?`), move the value there; otherwise ask the person. A value of
the wrong kind falls back to the default — write it in the kind the notice asks for. Tell the person
what you changed in one line each, e.g. `"statusline" → "status"`. Keep their comments and every
other key.

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
everything else in the file. `cockpit_settings` lists every block this version has, by its exact id,
with what it is set to now and the exact edit — use those; never guess an id
(`"-internal:sidebar-context"` does nothing on OpenCode 2).

| Block | OpenCode 1 (`tui.json` → `"plugin_enabled": { "<id>": false }`) | OpenCode 2 (`cli.json` → `"-<id>"` in `"plugins"`) | What to say |
| --- | --- | --- | --- |
| Context | `internal:sidebar-context` | `opencode.sidebar.context` | with Status's table in the sidebar, "Context" shows twice: suggest turning OpenCode's off |
| MCP | `internal:sidebar-mcp` | `opencode.sidebar.mcp` | optional, neutral: Status's table already warns when a server fails; `opencode mcp list` shows them all |
| Footer | `internal:sidebar-footer` | `opencode.sidebar.footer` | optional, neutral: the project's path and git branch at the bottom of the sidebar |
| LSP | `internal:sidebar-lsp` | — | optional, neutral |
| Files | `internal:sidebar-files` | — | optional, neutral |
| Todo | `internal:sidebar-todo` | — | **never suggest turning it off** — nothing in Cockpit replaces it. Off: offer it back |

On OpenCode 1 that is `{ "plugin_enabled": { "internal:sidebar-context": false } }`; on OpenCode 2,
add `"-opencode.sidebar.context"` to the `"plugins"` list, keeping the entries already there.

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

Then offer the second phase in one line: **"Want me to tune it to how you work?"** If not, stop
there. Someone who only wanted a quieter sidebar is done.

## 9. Make it fit how they work (only if they said yes)

Call `cockpit_settings` with **`tune: true`**. It adds the tour, this project's long-running
commands, ticket keys and remotes, and what each `AGENTS.md`'s Cockpit section says now.

1. **The tour.** One line per bay that is on, from the tool: what it does for them, with its real key
   and command. No more; they asked for a tour, not a manual.
2. **Ask about the project**, one question at a time, pre-filled from the tool's answer, only for
   the bays they have on:
   - **Shell** — which commands keep running (dev server, `docker compose up`, a test watcher)? Offer
     the ones the tool found, and a name for each ("dev server", "database"): the shell's
     description, which is how it is found again.
   - **Trail** — their ticket system and key prefix (offer the prefixes the history shows), the repos
     PRs go to, how they name things.
   - **Subagents** — explore in background subagents and keep the conversation free, or not.
3. **Write conventions only.** Every request already tells the agent how to use each bay; never
   write how to use Cockpit, only what no bay can know: *this* project's commands, keys, repos. The
   lines and their shape are in [references/conventions.md](references/conventions.md) — read it
   before drafting.
4. **Choose the file and ask.** This project's `AGENTS.md` (the default for commands; the team gets it
   if committed) or OpenCode's global one (every project — for a ticket prefix or a habit they use
   everywhere). Show the exact section and the file, and ask. If the tool says creating the file
   would stop OpenCode 1 reading a `CLAUDE.md`, say so first.
5. **Write it with `cockpit_conventions`** (`file`, `conventions` = the section's lines without its
   heading). It replaces the one marked section in place on a rerun and keeps everything else in the
   file byte for byte. Never edit the section by hand.
6. **Close:** what was written where; it applies to new conversations; `cockpit_conventions` with
   empty `conventions` removes it.

A rerun of this phase starts from the section the tool shows: change what they ask, keep the rest.
