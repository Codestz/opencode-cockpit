# Contributing

Thanks for helping. This guide covers setup, how the code is organised, and what a good change
looks like.

## Setup

Requirements: [Bun](https://bun.sh) 1.3.5 or newer, macOS or Linux, and OpenCode 1.18+ to try
changes for real.

```sh
bun install
bun run build        # compile every package's src/ to dist/ (what gets published)
bun run check        # build + lint + typecheck + tests
bun run pack:check   # pack every package, install the tarballs, run a shell through them
bun run smoke:tui    # drive a real OpenCode against the packed plugin (needs the opencode binary)
```

### Run your working copy inside OpenCode

Point both configs at the bundle (all features) or at a single feature's directory, using absolute
paths:

```jsonc
// ~/.config/opencode/opencode.jsonc
{ "plugin": ["/path/to/opencode-cockpit/packages/opencode"] }
```

```json
// ~/.config/opencode/tui.json
{ "plugin": ["/path/to/opencode-cockpit/packages/opencode"] }
```

Plugin entries point at `dist/`, so run `bun run build` after changing plugin code, then restart
OpenCode. Daemon changes are picked up automatically: the client
compares the running daemon's build id with its own code and replaces an idle daemon when its code
is newer (never older). If shells are running it keeps the old daemon and the panel tells you to
run `/shells-restart-daemon`.

Use `COCKPIT_HOME=/tmp/ck-dev` to keep a development daemon separate from your everyday one.

## Architecture

```
┌──────────────────────── OpenCode process ─────────────────────────┐
│  TUI thread                           Server worker               │
│  <feature>/tui                        <feature>/server            │
│  e.g. shell: panel · console · keys   e.g. shell: agent tools     │
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

**Features are plugins.** Each feature (`packages/shell`, later `packages/agents`) is a complete
OpenCode plugin that users can install alone. `packages/opencode` (`opencode-cockpit`) is a thin
bundle: it calls each feature's plugin factories and merges their hooks (`compose.ts`), with a
`features` option to switch some off.

**Dependency direction:** `opencode → features → client → protocol ← daemon`. The daemon never
imports OpenCode; features never import each other.

| Package | Contents |
|---|---|
| `protocol` | Zod contracts for every method (`contract`) and event (`events`), error codes, NDJSON framing, paths, build id |
| `daemon` | `core/` (RPC server with backpressure, router validating params, module host, idle lifecycle, logger) and `modules/shell/` |
| `client` | Connection, spawn lock, handshake, reconnect, idempotent retry, upgrade-only daemon replacement, `claimFeature` duplicate guard |
| `shell` | `core/` (pure logic both halves use), `agent/` (plugin + one file per tool), `tui/` (`components/`, `state/`, `lib/`), and thin entry files |
| `opencode` | The bundle: `server.ts`, `tui.ts`, `compose.ts` (hook merging), `features.ts` (switches and options) |

### Loading the same feature twice

OpenCode does not deduplicate plugin tools, and duplicate tool names make model requests fail. A
user who configures both `opencode-cockpit` and `@opencode-cockpit/shell` would hit that, so every
feature factory starts with `claimFeature(scope, name, source)`: the first copy loaded in an
OpenCode instance wins, later copies register nothing and warn (a toast in the TUI, a server log
on the server). The scope is the plugin input on the server and the renderer in the TUI, which
all plugins of one instance share. Claims are released on dispose so plugin reloads work.

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

### Adding a daemon capability

1. Contract: `packages/protocol/src/<name>.ts` (params and result schemas), spread into `contract`
   and `events` in `protocol/src/index.ts`.
2. Module: `packages/daemon/src/modules/<name>/` implementing `Module` (namespace, method table,
   `start`/`stop`/`busy`). Register it in `modules/index.ts`.
3. Surface it in a feature package (tools and/or TUI).

The router refuses methods missing from the contract, and handler params are typed from it.

### File layout

Files are grouped by role, not by type, and entry points stay thin:

- `core/` — pure logic with no I/O and no JSX, imported by both halves (finding, classifying,
  formatting).
- `core/config.ts` — one loader for every setting: global file → project `.cockpit.json` → plugin
  options, merged section-wise. Both halves call `loadConfig()` at startup and read from the result;
  nothing else parses config, and a broken file resolves to `{}` instead of throwing.
- `agent/` — the server plugin: `plugin.ts`, and `tools/` with one file per tool plus `shared.ts`
  for what they have in common.
- `tui/` — `components/` (JSX), `state/` (stores), `lib/` (pure helpers), `dialogs.tsx`.
- `packages/protocol/src/shell/` splits the wire schemas by concern (`common`, `info`, `params`,
  `watch`, `contract`).

Keep a module to one job; when a file passes ~300 lines it usually holds two. Exported zod schemas
must carry explicit types or stay module-private, or `tsc` cannot name them in declarations
(TS2883).

### Adding a feature

1. `packages/<feature>` named `@opencode-cockpit/<feature>`, exporting `./server` and/or `./tui`
   whose default export is a plugin built from factories (`create<Feature>Server`,
   `create<Feature>Tui`) that accept a `source` label and start with `claimFeature`.
2. Add it to `FEATURES` in `packages/opencode/src/features.ts` and call its factories in the
   bundle's `server.ts` / `tui.ts`.
3. Add the directory to `PACKAGES` in `scripts/pack-check.ts` and to the publish loop in
   `.github/workflows/release.yml`, before `opencode`.
4. A brand-new npm package cannot use Trusted Publishing until it exists: its first release needs
   a short-lived `NPM_TOKEN` secret, then configure its trusted publisher and delete the token.

### Publishing rule: compile, never ship JSX

OpenCode compiles plugin JSX with OpenTUI's Solid transform, and that Bun plugin skips every file
under `node_modules` — where an installed plugin always lives. Published `.tsx` therefore loads,
logs and talks to the daemon while rendering exactly one frozen frame (0.1.3 and 0.1.4 shipped that
way). `scripts/build.ts` compiles every package the same way, with the same transform, and packages
export `dist/`.

For the same reason `solid-js` and `@opentui/*` are devDependencies, never dependencies: the
compiled code imports them by name and OpenCode rewrites those imports to its own instances, which
is what keeps reactivity and the keymap shared with the host. Shipping copies gives a second Solid
instance and the panel freezes again.

Guards: `bun run pack:check` fails if a published TUI entry is not Solid-compiled or if those
packages get installed alongside; `bun run smoke:tui` drives a real OpenCode and fails if the panel
stops updating.

## Conventions

- TypeScript strict, ESM, Bun APIs are fine. Biome formats and lints (`bun run lint:fix`).
- Comments explain *why*, not what.
- Protocol changes: additive changes bump `PROTOCOL_VERSION.minor`; breaking ones bump `major`.
- A project that imports a `.tsx` entry through a project reference needs `"jsx": "preserve"` in its
  tsconfig, even without JSX of its own, or `tsc -b` reports TS6305.
- Mouse handlers that open a dialog must use `onMouseUp`: the host dialog closes on the mouse-up
  that follows, so opening on press requires holding the button down.
- TUI text: every line is `wrapMode="none"` and truncated to a computed width, so layout never
  depends on terminal size. Use single-width glyphs (`•`, braille spinner), not emoji or
  ambiguous-width symbols.

## Tests

Tests run real PTYs against a real daemon in a temporary `COCKPIT_HOME`; please keep it that way
rather than mocking the process layer.

- `packages/daemon/test`: output pipeline and process registry
- `packages/client/test`: protocol acceptance, lifecycle, reuse, build mismatch
- `packages/shell/test`: agent tools (including OpenCode's raw argument quirks) and view logic
- `packages/opencode/test`: hook composition, feature options, duplicate-load guard

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
