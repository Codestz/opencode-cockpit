---
title: Troubleshooting
description: Where Cockpit writes down what went wrong, and the failures people actually hit.
---

## Run the doctor

```sh
npx opencode-cockpit@latest doctor
```

It checks OpenCode, its config, what Cockpit logged, the daemon and the tools it needs, and prints
the fix for anything wrong — even when Cockpit will not load at all. What it checks is in
[Doctor](/opencode-cockpit/help/doctor/).

## Where to look first

Cockpit writes what it does inside OpenCode to **one file**, whichever OpenCode you run:

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

One JSON line per event. Every start says which OpenCode (1 or 2) loaded which bay, and every error
is there with its stack — including the ones that were only a toast for a few seconds. `scope` says
where it came from: `tui:shell` is Shell's panel, `server:review` Review's agent tools.

To see *everything* — console actions, each tool call and how long it took — start OpenCode with:

```sh
COCKPIT_DEBUG=1 opencode
```

The other places, in the order they help:

| What | Where |
| --- | --- |
| The shell daemon | `~/.cache/opencode-cockpit/cockpitd.log` |
| Review's full reports (timings, layout) | `~/.local/share/opencode-cockpit/review/<project>/trouble.log` |
| A plugin OpenCode 2 would not load | `/plugins` in OpenCode — press space on the failed one for its error |
| A plugin OpenCode would not load at all | OpenCode's own log, newest file in `~/.local/share/opencode/log/` |

### Opening an issue

Attach what the doctor found and the end of the log:

```sh
npx opencode-cockpit@latest doctor --json > doctor.json
tail -200 ~/.cache/opencode-cockpit/cockpit.log > cockpit.log
```

Better still, reproduce it once with `COCKPIT_DEBUG=1` first. The log holds paths and shell
commands from your machine, but never your code or conversation — look it over before posting.

## OpenCode 2 lists Cockpit as failed

Cockpit before 0.6 runs on OpenCode 1 only. Change the version in your `opencode.json` entry to
the newest release, then restart:

```json title="~/.config/opencode/opencode.json"
{ "plugin": ["opencode-cockpit@<newest version>"] }
```

Edit the entry you have rather than running `opencode plugin add` beside it: `add` writes a second
entry under `"plugins"` and leaves the old one, and two copies of a bay mean one of them stands down.

Which version runs where is in [OpenCode 1 and 2](/opencode-cockpit/start/opencode-versions/).

## Tools fail with "did not start"

The daemon could not spawn. Its log is the first place to look:

```sh
tail -40 ~/.cache/opencode-cockpit/cockpitd.log
```

## The plugin doesn't load at all

On OpenCode 2, `/plugins` lists it as failed and space shows why. On either, OpenCode's own log —
newest file in `~/.local/share/opencode/log/` — reports a plugin that fails to import. If nothing
names Cockpit there, check it is in the config the OpenCode you run reads: `"plugin"` for 1,
`"plugins"` for 2.

## "Environment variable OPENTUI_FORCE_WCWIDTH is already registered"

OpenCode 2 is loading Cockpit from a git checkout. A checkout carries its own copy of the libraries
OpenCode draws with, and two copies cannot load at once. Install a package instead — from a
checkout, `bun run dev:install` installs one to `~/.cockpit-dev` to point OpenCode at.

## A statusline module says "Cannot find package '@opencode-cockpit/status'"

A module outside a project (in `~/.config/opencode-cockpit/`, say) imports
`@opencode-cockpit/status/segment`, which only resolves where Status is installed. Cockpit rewrites
that import for you; before 0.6 it did not recognise OpenCode 2's wording of the error. Update.

## "Shell is configured twice"

The bay is installed both through `opencode-cockpit` and on its own. Remove one of the entries —
from **both** `opencode.json` and `tui.json` on OpenCode 1, from `opencode.json` on OpenCode 2.

## The full-screen console shows the conversation through it

A theme with a transparent background (OpenCode's "system" theme shows the terminal's own) left the
full-screen console and the Review pane see-through before 0.6. Update.

## An agent starts shells without asking, on OpenCode 2

Known: OpenCode 2 gives a plugin tool no documented way to ask for permission, so `shell_start` is
not held by your `bash` rules there. We are working on making it ask, as it does on OpenCode 1. See [what differs](/opencode-cockpit/start/opencode-versions/#what-differs-on-opencode-2).

## The panel says the daemon runs older code

A newer plugin connected, but shells were running so the daemon was kept. Run
`/shells-restart-daemon` once those shells are finished.

## I updated but nothing changed

OpenCode resolves a plugin spec once and caches it for ever, so `@latest` — or no version at all —
stays on the release it first installed.

On **OpenCode 1**, run `/plugins-update`, or from a shell, whatever version you are on:

```sh
npx opencode-cockpit@latest update
```

It pins the newest version, clears the stale cache, and checks both files; then restart.

On **OpenCode 2**, change the version in your `opencode.json` entry and restart — the updater above
edits OpenCode 1's files only.

To check which build is actually running, the newest start line says it:

```sh
grep '"msg":"start"' ~/.cache/opencode-cockpit/cockpit.log | tail -1
```

## A setting seems to do nothing

Settings merge global → project → plugin entry. A `.cockpit.json` in the project wins over your
global file, and an invalid file is ignored silently by design — check it parses:

```sh
cat .cockpit.json | python3 -m json.tool
```

## Shells are gone after a restart

They survive OpenCode restarts, not machine restarts: the daemon exits when idle and reaps what it
owned. Shells finished more than `ui.historyMinutes` ago are also hidden from the panel by default.
