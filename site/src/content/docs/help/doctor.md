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

**Environment.** `git` on your PATH (Review reads branches through it), `ps` (the daemon stops a
shell's processes with it), and a Cockpit home it can write to.

**Settings.** `~/.config/opencode-cockpit/config.json` and the project's `.cockpit.json` parse — an
invalid one is ignored whole — and every statusline module they list exists.

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
copy of a plugin OpenCode loaded; and it runs from a terminal, not from inside OpenCode.
[Troubleshooting](/opencode-cockpit/help/troubleshooting/) covers the rest.
