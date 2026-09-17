# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/Codestz/opencode-cockpit/security/advisories/new)
rather than public issues. Expect an acknowledgement within a few days.

## Scope and design notes

- `cockpitd` listens only on a unix socket inside a `0700` directory with the socket at `0600`, so
  only the owning user can connect. There is no network listener.
- Shells run with the privileges of the user who started OpenCode.
- Agent-started shells go through OpenCode's permission flow using the same `bash` rules as the
  built-in tool.
- The daemon passes the plugin's environment to spawned shells, as the built-in `bash` tool does.
  Treat shell output (and the daemon log at `~/.cache/opencode-cockpit/cockpitd.log`, which records
  commands) as sensitive.
