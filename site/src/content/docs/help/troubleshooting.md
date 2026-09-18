---
title: Troubleshooting
description: The failures people actually hit, and where to look.
---

## Tools fail with "did not start"

The daemon could not spawn. Its log is the first place to look:

```sh
tail -40 ~/.cache/opencode-cockpit/cockpitd.log
```

## The plugin doesn't load at all

Check OpenCode's own log — newest file in `~/.local/share/opencode/log/`. A plugin that fails to
import is reported there.

## "Shell is configured twice"

The bay is installed both through `opencode-cockpit` and on its own. Remove one of the entries from
**both** `opencode.json` and `tui.json`.

## The panel says the daemon runs older code

A newer plugin connected, but shells were running so the daemon was kept. Run
`/shells-restart-daemon` once those shells are finished.

## I updated but nothing changed

OpenCode resolves an unpinned plugin spec once and caches it. Run `/cockpit-update`, which clears the
cache entry, then restart. To check which build is actually running:

```sh
grep '"daemon started"' ~/.cache/opencode-cockpit/cockpitd.log | tail -1
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
