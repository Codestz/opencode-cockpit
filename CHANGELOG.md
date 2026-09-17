# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Codestz/opencode-cockpit/releases/tag/v0.1.0
