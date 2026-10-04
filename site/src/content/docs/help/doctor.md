---
title: Doctor
description: One command that checks your setup and prints the fix for anything wrong — on OpenCode 1 and 2.
---

```sh
npx opencode-cockpit@latest doctor
```

Doctor checks OpenCode, its config, what Cockpit logged, the daemon and the tools Cockpit needs, and
for anything wrong prints the exact line that fixes it — spelled for the OpenCode you have. It runs
outside OpenCode, from npm, so it works when Cockpit will not load at all, and whatever version you
have installed.

```
Cockpit doctor

 ✓ OpenCode     2.0.15 (OpenCode 2)
 ✗ Config       Cockpit is configured, but will not load as written
                opencode-cockpit@0.5.2  (~/.config/opencode/opencode.json)
                → opencode-cockpit@0.5.2 is OpenCode 1 only (0.6 is the first for both). change the
                  entry to "opencode-cockpit@0.6.0" in opencode.json, then restart OpenCode
 ✓ Last run     Cockpit 0.6.0 on OpenCode 2, 2026-09-24T11:00:01Z
 ! Errors       1 error, 0 warnings in the last day
                2026-09-24T11:00:00Z  error tui:review  review: trouble: …
                → the full lines, with stacks: tail -100 ~/.cache/opencode-cockpit/cockpit.log
 · Daemon       not running — it starts with the first shell, and stops when idle
 ✓ Service      OpenCode 2's background service is not running; a window starts it
 ✓ Environment  git, ps, and a writable Cockpit home
 ✓ Settings     1 file, 1 statusline module

1 to fix, 1 to look at
```

`✓` fine · `·` for your information · `!` worth a look · `✗` must be fixed.

## What it checks

**OpenCode.** Whether `opencode` is installed, and whether Cockpit runs on its version: 1.18 and
newer, and 2.0.15 and newer. Anything older, it says so and what to run.

**Config.** Every file either OpenCode reads plugins from — `opencode.json`, `tui.json`, `cli.json`
(and `.jsonc`), global and in the project — in both spellings: OpenCode 1's `"plugin"`, OpenCode 2's
`"plugins"` with its `{ "package", "options" }` entries. It flags:

- a file that does not parse
- Cockpit not configured at all — with the install line
- a bay configured twice, as `opencode-cockpit` and on its own — one of them stands down
- on OpenCode 1, a half missing: in `opencode.json` but not `tui.json` means no panels; the reverse,
  no agent tools
- on OpenCode 2, an entry pointing at a git checkout — the one that fails with
  `OPENTUI_FORCE_WCWIDTH is already registered`
- an entry without an exact version, which OpenCode never updates
- a version older than the newest published, or older than 0.6 on OpenCode 2

**Last run.** What actually loaded, from the start lines in `cockpit.log`: each bay, its Cockpit
version, which OpenCode and when. This is the answer to "the config says one thing, but what is
running?" — and two different Cockpit versions loaded at once is flagged.

**Errors.** Errors and warnings from the last day, in Cockpit's log and the daemon's, with the latest
messages — including the ones that were only a toast.

**Daemon.** Whether the shell daemon is running, and the build it was started from.

**Service.** On OpenCode 2 only: whether its background service runs the Cockpit installed now. The
service loads plugins once, when it starts, so after an install or an update it keeps the old agent
side — no new tools, no new skills — until `opencode service restart`. Doctor reads which install the
agent side recorded when it loaded, and warns when a newer one was installed since; with no record,
it compares when the service started with when Cockpit was installed.

**Subagents.** Where Subagents is installed: whether subagents can run in the background. OpenCode 2
has it built in; OpenCode 1 only when started with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`,
and doctor gives the line for your shell's profile when it is missing.

**Environment.** `git` on your PATH (Review reads branches through it), `ps` (the daemon stops a
shell's processes with it), and a Cockpit home it can write to.

**Settings.** `~/.config/opencode-cockpit/config.json` and the project's `.cockpit.json` parse
(comments and trailing commas are fine; a file that does not is ignored whole, and the defaults
apply), every setting is read as written — a name from before 0.9, a value of the wrong kind, a
Status `override` that matches no segment are each listed, the same notices the bays draw as `!`
rows — and every statusline module they list exists.

## For an issue

```sh
npx opencode-cockpit@latest doctor --json > doctor.json
```

Everything doctor found, as JSON: the config entries, the start and error lines it read, the checks.
It holds paths from your machine, not your code or conversation — look it over before attaching it.

## In a script

Doctor exits `1` when something must be fixed and `0` otherwise, so it answers "is Cockpit set up?"
for a dotfiles script or CI.

## Not yet

Doctor checks that statusline modules exist, not that they load; it does not yet know which cached
copy of a plugin OpenCode loaded; and it runs from a terminal, not from inside OpenCode — though
inside OpenCode, `cockpit_settings` gives the agent the same settings notices.
[Troubleshooting](/help/troubleshooting/) covers the rest.
