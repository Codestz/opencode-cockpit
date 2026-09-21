# @opencode-cockpit/updater

**Every OpenCode plugin you have installed: what actually runs, what your config says, what is
published — and an update that is checked against disk.**

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). It comes with the bundle, and
it also runs on its own from a shell, without OpenCode running at all.

## Why it exists

OpenCode installs each plugin into a cache directory named after the spec you wrote, and never
resolves that spec again. So `some-plugin@latest` — or a bare `some-plugin` — means *the latest
release on the day you first installed it*, for ever. Restarting does not move it. Nothing shows you
it happened: the config says `latest`, and nothing says `0.1.2`.

A plugin cannot fix that for itself. Its fix only reaches people who already updated.

## From a shell — works on any version, including a stuck one

```sh
npx opencode-cockpit@latest update
# or
bunx opencode-cockpit@latest update
# or, this package on its own
npx @opencode-cockpit/updater@latest
```

Each re-resolves `@latest` every time it runs, which is exactly what OpenCode's cache does not do.

```
plugin                        running   config          published
opencode-cockpit              0.1.2     latest  ⚠       0.5.0       ↑
opencode-foo                  1.2.0     @1.2.0          1.3.0       ↑
bar                           2.0.0     @2.0.0          2.0.0

opencode-cockpit              0.1.2  →  0.5.0
  ~/.config/opencode/opencode.jsonc   opencode-cockpit  →   opencode-cockpit@0.5.0
  ~/.config/opencode/tui.json         opencode-cockpit  →   opencode-cockpit@0.5.0
  remove  ~/.cache/opencode/packages/opencode-cockpit@latest

Update 2 plugins? [Y/n]
```

`--only <name>` for one plugin, `--dry-run` to see the plan and write nothing, `--yes` to not be asked.

## Inside OpenCode

`/plugins-update` opens the same list as a dialog: `space` selects, `a` selects every update, `enter`
shows exactly what will change, and `enter` again does it. `/cockpit-update` opens it too.

Once a day it checks the registry and, if something is behind, says so once:
`2 plugin updates available. Run /plugins-update.` Turn that off with `"updateCheck": false` under
`updater` (or Shell's old `ui`) in `~/.config/opencode-cockpit/config.json`.

## What an update does

1. Rewrites the spec to an **exact version** — the only kind OpenCode will not freeze — by running
   `opencode plugin <name>@<version> -f`, so OpenCode's own writer edits its own config and your
   comments survive. The updater never writes a config file itself.
2. Removes that plugin's stale cache directories, `@latest` included.
3. **Reads every file back.** `opencode plugin` prints "Installed" over entries it left alone, so what
   counts is disk. Anything still wrong is shown with the exact command or edit that fixes it.

A project's root-level `opencode.json` is never rewritten by `opencode plugin` — it adds a second entry
under `.opencode/` instead. Those rows say **edit by hand**, and the result checks them too.

Built-in plugins and local paths are listed and never touched. A registry that does not answer is `?`,
never "current".

## Settings

| key | |
| --- | --- |
| `updateCheck` | `false` stops the daily check. Default `true`. |
