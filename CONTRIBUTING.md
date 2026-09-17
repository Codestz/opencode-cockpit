# Contributing

Thanks for helping. This guide covers setup, how the code is organised, and what a good change
looks like.

## Setup

Requirements: [Bun](https://bun.sh) 1.3.5 or newer, macOS or Linux, and OpenCode 1.18+ to try
changes for real.

```sh
bun install
bun run check        # lint + typecheck + tests
bun run pack:check   # pack every package, install the tarballs, run a shell through them
```

### Run your working copy inside OpenCode

Point both configs at the plugin directory (use absolute paths):

```jsonc
// ~/.config/opencode/opencode.jsonc
{ "plugin": ["/path/to/opencode-cockpit/packages/opencode"] }
```

```json
// ~/.config/opencode/tui.json
{ "plugin": ["/path/to/opencode-cockpit/packages/opencode"] }
```

Restart OpenCode after plugin changes. Daemon changes are picked up automatically: the client
compares the running daemon's build id with its own code and replaces an idle daemon. If shells
are running it keeps the old daemon and the panel tells you to run `/shells-restart-daemon`.

Use `COCKPIT_HOME=/tmp/ck-dev` to keep a development daemon separate from your everyday one.

## Architecture

```
┌──────────────────────── OpenCode process ─────────────────────────┐
│  TUI thread                           Server worker               │
│  opencode-cockpit/tui                 opencode-cockpit/server     │
│  panel · console · sidebar · keys     agent tools · notifications │
└──────────────┬────────────────────────────────────┬───────────────┘
               └────────── @opencode-cockpit/client ─┘
                                  │ JSON-RPC 2.0 · NDJSON · unix socket (0600)
               ┌──────────────────▼──────────────────┐
               │ cockpitd (@opencode-cockpit/daemon) │
               │ core: rpc · modules · lifecycle     │
               │ modules/shell: PTYs · output views  │
               │   · waits · process registry        │
               └─────────────────────────────────────┘
```

**Why a daemon.** OpenCode runs plugin server code in a Bun Worker and the TUI on the main thread;
the two halves of a plugin cannot share memory. Instead of bridging them, both are clients of one
daemon that owns all long-lived state. Shells therefore survive OpenCode restarts and are shared
across OpenCode windows. The daemon starts on demand through the OpenCode binary itself
(`BUN_BE_BUN=1`), so users need no separate runtime, and exits after an idle timeout.

**Dependency direction:** `opencode → client → protocol ← daemon`. The daemon never imports
OpenCode.

| Package | Contents |
|---|---|
| `protocol` | Zod contracts for every method (`contract`) and event (`events`), error codes, NDJSON framing, paths, build id |
| `daemon` | `core/` (RPC server with backpressure, router validating params, module host, idle lifecycle, logger) and `modules/shell/` |
| `client` | Connection, spawn lock, handshake, reconnect, idempotent retry, outdated-daemon handling |
| `opencode` | `server.ts` + `tools/` (agent tools, formatting for models), `tui/` (store, dock, console, sidebar, badges) |

### Shell output: three views of one byte stream

1. **Log** (`output/normalizer.ts` → `output/line-log.ts`): strips escape sequences, applies
   carriage-return/backspace/erase-line semantics, commits lines with numbers that never change,
   evicts by size. This is what agents read.
2. **Screen** (`output/screen.ts`): `@xterm/headless`, exactly what a human would see, including
   full-screen programs.
3. **Raw ring** (`output/raw-ring.ts`): bytes by absolute offset, replayed to clients that attach
   late.

### Invariants

- The daemon is the only owner of shell state; clients hold views.
- Every request is schema-validated before it reaches a module.
- Every process is a process-group leader and is killed as a group. Live groups are recorded in
  `shells.json` so a restarted daemon can reap orphans (start time guards against pid reuse).
- Log line numbers are monotonic for a shell's lifetime, so cursors survive eviction and restarts.
- The agent is only messaged on state changes (exit), never per line.

### Adding a capability

1. Contract: `packages/protocol/src/<name>.ts` (params and result schemas), spread into `contract`
   and `events` in `protocol/src/index.ts`.
2. Module: `packages/daemon/src/modules/<name>/` implementing `Module` (namespace, method table,
   `start`/`stop`/`busy`). Register it in `modules/index.ts`.
3. Surface it in `packages/opencode` (tools and/or TUI).

The router refuses methods missing from the contract, and handler params are typed from it.

## Conventions

- TypeScript strict, ESM, Bun APIs are fine. Biome formats and lints (`bun run lint:fix`).
- Comments explain *why*, not what.
- Protocol changes: additive changes bump `PROTOCOL_VERSION.minor`; breaking ones bump `major`.
- TUI text: every line is `wrapMode="none"` and truncated to a computed width, so layout never
  depends on terminal size. Use single-width glyphs (`•`, braille spinner), not emoji or
  ambiguous-width symbols.

## Tests

Tests run real PTYs against a real daemon in a temporary `COCKPIT_HOME`; please keep it that way
rather than mocking the process layer.

- `packages/daemon/test`: output pipeline and process registry
- `packages/client/test`: protocol acceptance, lifecycle, reuse, build mismatch
- `packages/opencode/test`: agent tools (including OpenCode's raw argument quirks) and view logic

Bug fixes come with a test that fails before the fix.

## Pull requests

- Keep them focused; describe the behaviour change and how you verified it.
- `bun run check` and `bun run pack:check` must pass.
- User-visible changes get a line under **Unreleased** in `CHANGELOG.md`.

## Releasing (maintainers)

```sh
bun run version:set 0.2.0     # every package
# move Unreleased notes under a 0.2.0 heading in CHANGELOG.md, commit
git tag v0.2.0 && git push origin main v0.2.0
```

The release workflow checks, packs, publishes all packages to npm with provenance in dependency
order, and creates the GitHub release. Authentication is npm Trusted Publishing: each package on
npmjs.com lists `Codestz/opencode-cockpit` with workflow `release.yml` as its trusted publisher,
so no token is stored. (The `NPM_TOKEN` secret is only needed to publish a brand-new package for
the first time.)
