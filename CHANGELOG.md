# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-17

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

[Unreleased]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Codestz/opencode-cockpit/releases/tag/v0.1.0
