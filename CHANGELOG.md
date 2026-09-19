# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Statusline, bay 02.** A line of live session state under the conversation, or a column of it in
  the sidebar. Fourteen built-in segments, two surfaces, and three ways to configure it: declarative
  segments in `.cockpit.json`, your own TypeScript module, or a shell command.
  `opencode plugin @opencode-cockpit/status --global`, or get it with the bundle.
- **Your Claude Code statusline works here.** A command segment is fed the same JSON on stdin that
  Claude Code's `statusLine` hook sends, including `context_window` and `current_usage`, so an
  existing script runs unchanged. Its colours survive too: the SGR escapes are parsed rather than
  stripped, with 24-bit and 256-colour values kept exactly and the basic sixteen mapped to theme
  tones. Multi-row scripts keep their rows.
- **Segments written in TypeScript**, against `@opencode-cockpit/status/segment`. A module is handed
  the same snapshot the built-ins get and touches no OpenCode api, so a custom segment is as
  testable as a built-in — and because it is loaded once and called on every repaint, it can keep
  history, which is what makes a sparkline or a rate possible. A module can live in your config
  directory rather than inside a project; nothing needs installing beside it.
- **Honest behind a proxy.** Tokens always work. Cost and the context percentage are computed from
  your model catalogue, so behind LiteLLM or a gateway they need declaring in `provider.<id>.models`
  — and where they are not declared, those segments stay silent rather than reporting `$0.00` and
  `0%`. The same rule runs through the bay: a segment with nothing to say says nothing.

### Changed

- **Shell's status marks are a coloured rule rather than a filled pill.** A block of colour has to
  be as wide as the word inside it, and a column of them reads as a wall of colour competing with
  the shell names beside it. Same seven columns, so lists still line up.
- Room under the **Shells** heading in the sidebar, so the title reads as a heading and not as the
  first item of the list.

## [0.2.2] - 2026-09-18

### Changed

- **The panel shows the conversation you are in.** A project's shells listed together stopped making
  sense as soon as two sessions were open. Switching conversations now changes what the panel lists,
  without stopping anything; `s` in the console widens it to the whole project and back, and
  `shell_list` already took `session`.
- **Shells end with the window that started them.** `lifecycle.onExit` defaults to `stopMine`, so
  closing OpenCode stops its own shells — a window closing counts only once both halves of the
  plugin have gone, so quitting one of two open windows never touches the other's. `keep` restores
  the old behaviour of leaving them for the next window.

### Added

- `lifecycle.orphanAfterMinutes` (60 by default): a shell no window has been connected to for that
  long is stopped, so nothing runs for a week because everyone who knew about it has gone.
- `/shells-stop` stops the shells in view; `/shells-stop-all` stops every shell in the project and
  confirms first when that reaches conversations you are not looking at. "Everything I can see" and
  "everything, including what I cannot" are different intentions.

### Fixed

- A shell started by hand had no session recorded, so the session-scoped panel did not list it — and
  attaching then asked the daemon for output from an offset past the end, which crashed the handler
  and left the console empty. Manual shells now belong to the conversation they were started from,
  attaching looks in every shell rather than only the listed ones, and an offset past the end is
  read as "only what comes next" instead of an error.

## [0.2.1] - 2026-09-18

### Added

- `watch` on `shell_start` takes a rule object (`{ done, fail, ok, idleSeconds }`), not only a preset
  name. It read as documented before and was not. A rule that arrives as JSON *text* is parsed as a
  rule too — including the under-escaped JSON a model writes when the patterns are regexes
  (`{"done": "\d+ passed"}`) — instead of being passed on as a preset name nobody has.
- Watching a command no preset matches no longer fails: the shell is watched for dying (preset
  `exit`), so `sleep 300`, a deploy script or any quiet process gets crash detection without
  patterns.

### Changed

- An ended shell says why it ended and who ended it, instead of "killed by SIGTERM": "stopped: hit
  its time limit", "stopped: no output for its idle limit", "stopped by you, from the shells panel",
  "stopped by the agent", "crashed with exit code 3". `ShellInfo` carries `stopReason` and
  `stoppedBy` (protocol 1.3), and the panel shows the short form.
- Clearer watch errors: an unknown preset now says `no watch preset named "x"` and points at both
  `shell.presets` and custom rules.

## [0.2.0] - 2026-09-18

### Added

- **Configuration.** One file, read by both halves of the plugin:
  `~/.config/opencode-cockpit/config.json`, then `<project>/.cockpit.json`, then plugin-entry
  options, merged key by key. Define your own shell `kinds` (regex → name, also filterable in
  `shell_list`), your own `watch.presets`, `defaults` applied to every shell the agent starts
  (`watch`, `logFile`, `timeoutSeconds`, `idleTimeoutSeconds`, `notifyOnExit`), what may interrupt
  the agent (`notify`), how much context the plugin spends (`guidance`, `listRunningShells`), and
  the interface (`ui`). `watch.auto` attaches a matching preset to every new shell; it is off by
  default. An invalid config file is ignored rather than fatal.
- **Watchers.** `shell_watch`, or `watch` on `shell_start`, follows a never-ending process and
  messages the agent only when its health changes ("tsc: ok → fail" with the offending line), never
  while a run repeats the same result. A watched process that dies is reported as a failure, so a
  crashed dev server no longer goes unnoticed. The panel, sidebar and console show the health
  (`tsc ✓`, `vitest ✗`), and `shell_list` includes it.
- A watch rule is three regexes — `done`, `fail`, `ok` (plus `idleSeconds`) — not a parser. About 35
  presets ship for common tools (tsc, eslint, biome, prettier, mypy, ruff, vitest, jest, mocha, bun
  test, deno test, pytest, rspec, phpunit, playwright, cypress, vite, next, nuxt, astro, angular,
  webpack, esbuild, tsup, turbo, metro, storybook, cargo, go, dotnet, gradle, maven, docker compose,
  terraform), picked automatically from the command; anything else takes its own patterns.
- An update notice: the plugin checks the registry at most once a day and offers `/cockpit-update`,
  which clears its cache entry so the next start installs the new version. OpenCode resolves an
  unpinned plugin spec only once, so installs never moved forward on their own.
- `bun run release <patch|minor|major|x.y.z> [--push]` bumps every package, promotes the changelog
  and tags, so releases stop being a manual edit.
- **Log search in the console.** `/` filters a shell's scrollback to matching lines, keeping line
  numbers and highlighting matches; `backspace` clears the filter. Filtering runs in the daemon.
- **Colours.** The panel and console paint the colours programs actually print, instead of stripping
  them.
- **Limits.** `idleTimeoutSeconds` stops a shell after that much silence (never a default: healthy
  dev servers are idle), alongside the existing `timeoutSeconds` wall-clock limit. Both explain
  themselves in the shell's summary.
- **Log files.** `logFile` writes a shell's clean log to `~/.cache/opencode-cockpit/logs/<id>.log`,
  so history survives the in-memory buffer.
- **Shell kinds.** Shells classify themselves from their command (server, tests, build, watcher,
  task); `shell_list` filters by `kind`, so "which servers are up?" is one call.

### Changed

- Package internals are grouped by role: `core/` (pure logic shared by both halves), `agent/` (the
  server plugin and one file per tool), `tui/` (`components/`, `state/`, `lib/`), and the wire
  schemas split by concern. No behaviour change, but features now land in one obvious place.
- Console keys now show only what applies: no sidebar-only "show all", no "clear finished" without
  finished shells, and `[` `]` cycles every shell rather than just the unfolded ones.

## [0.1.5] - 2026-09-18

### Fixed

- The TUI half rendered one frozen frame when installed from npm: the panel, console and sidebar
  appeared but never updated, while keybinds, RPC calls and shells all worked. OpenCode compiles
  plugin JSX with OpenTUI's Solid transform, whose Bun plugin skips every file under
  `node_modules` — where an installed plugin always lives — so published `.tsx` produced
  components with no reactive tracking. Every package now publishes JavaScript compiled with that
  same transform. A local checkout was never affected, which is why 0.1.3 and 0.1.4, which guessed
  at dependency layout, did not fix it.
- Clicking a shell in the sidebar or panel needed the mouse button held down: the console opened on
  press, and the release landed on the dialog backdrop, which closes it. They open on release now.

### Changed

- `solid-js` and `@opentui/*` are no longer shipped with the plugin. The compiled code imports them
  by name and OpenCode rewrites those imports to its own instances, which is what keeps reactivity
  and the keymap shared with the host.
- The sidebar shows at most 5 shells (`sidebarRows`), then `▸ N more`; expanding caps at 12 and
  points to the console. The panel keeps its tabs to what fits the window. A hundred shells can no
  longer push the sidebar off screen.
- Every package builds through one script (`bun run build`) and publishes `dist/`.

### Added

- `bun run smoke:tui` drives a real OpenCode against the packed plugin and fails if the panel stops
  updating; `bun run pack:check` fails if a published TUI entry is not Solid-compiled or if
  `solid-js`/`@opentui/*` are installed with the plugin.

## [0.1.4] - 2026-09-17

### Fixed

- `@opencode-cockpit/shell` pinned `solid-js` to `1.9.15`, one patch version above the `1.9.12`
  that `@opentui/solid` and `@opentui/keymap` require as a peer. A published install (plain `npm
  install`, as the opencode plugin installer runs) can't satisfy both from one copy, so it nested a
  second private `solid-js` under `@opencode-cockpit/shell`. Solid's reactivity is instance-local:
  the docked panel and console read signals from the nested copy while `@opentui/solid`'s render
  bridge tracked the hoisted one, so the panel painted once on open and then never updated again —
  keybinds and shell output all reached the daemon fine, nothing ever reappeared on screen. Pinning
  `solid-js` to the exact version the peer requires (`1.9.12`) collapses both back to one instance.
  Bun workspaces (`bun install` from source, `bun run pack:check`) tolerate the mismatch by
  deduping anyway, which is why this didn't reproduce there — only a real `npm install` split it.

## [0.1.3] - 2026-09-17

### Added

- Shell tools accept a shell's name instead of its id, e.g. `shell_read name="DB Monitoring"`;
  ambiguous names return the candidates.
- `shell_list` filters by text, status and session, and shows which session (by title) or the user
  started each shell. The agent's system prompt marks shells from other sessions.

### Changed

- `opencode-cockpit` no longer lists `@opencode-cockpit/client` as a runtime dependency (it comes
  through the features that use it).

### Fixed

- `@opencode-cockpit/shell` declared `@opentui/core`, `@opentui/keymap`, `@opentui/solid`, and
  `solid-js` as peer dependencies, which the opencode plugin installer does not install. A fresh
  install of the published package silently dropped the TUI half (no docked panel, no keybinds),
  while the server half kept working. They are now real dependencies.

## [0.1.2] - 2026-09-17

### Added

- Features ship as separate plugins: install everything with `opencode-cockpit`, or only
  `@opencode-cockpit/shell`. `opencode-cockpit` accepts `features` to switch features off and
  per-feature options under the feature's name (top-level Shell options from 0.1.x still work).
- A feature configured twice (bundle and standalone) loads once, with a warning naming the entry to
  remove.

### Changed

- An outdated daemon is only replaced by clients running newer code, so plugins at different
  versions sharing one daemon no longer replace each other.

## [0.1.1] - 2026-09-17

### Fixed

- Packages published as 0.1.0 depended on internal package version 0.0.1, which does not exist,
  so `opencode-cockpit@0.1.0` could not be installed. Use 0.1.1.
- Releases now fail before publishing if a packed package pins an internal dependency to a
  version other than the one being released.
- `shell_wait` / `shell.wait` with a pattern now matches a prompt that was already on screen
  (no trailing newline) before the wait started, instead of timing out.

## [0.1.0] - 2026-09-17 [YANKED]

### Added

- **Shell**: background PTY shells hosted by `cockpitd`, shared across OpenCode windows and
  surviving restarts.
- Agent tools `shell_start`, `shell_wait`, `shell_read`, `shell_send`, `shell_list`,
  `shell_stop`, `shell_restart`, with permission prompts through OpenCode's `bash` rules.
- Wait conditions: output pattern (including unfinished prompt lines), open port, idle output,
  exit.
- Clean agent logs: escape sequences removed, redraws collapsed, repeated lines folded,
  cursor-based reads and grep.
- Exit notifications to the session that started a shell.
- Reuse of finished shells for repeated commands within a session.
- TUI: docked shells panel, sidebar section, keyboard-first console with typing mode, log and
  details views, status badges, folding of finished shells, clear finished.
- Daemon lifecycle: on-demand start, single instance under concurrent starts, idle shutdown,
  replacement of outdated idle daemons, orphan reaping after crashes.

[Unreleased]: https://github.com/Codestz/opencode-cockpit/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Codestz/opencode-cockpit/releases/tag/v0.1.0
