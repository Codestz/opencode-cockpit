# @opencode-cockpit/shell

[![npm](https://img.shields.io/npm/v/@opencode-cockpit/shell)](https://www.npmjs.com/package/@opencode-cockpit/shell)

Background terminals for [OpenCode](https://opencode.ai) that the agent starts, waits on and
drives, and that you watch and control without leaving the chat. Part of
[opencode-cockpit](https://github.com/Codestz/opencode-cockpit).

- **The agent stops sleeping and polling.** It starts a dev server and blocks until the port
  opens, runs a slow test suite and gets a message when it finishes, drives REPLs and prompts.
- **Logs that don't waste tokens.** Colours are stripped, progress-bar redraws collapse to their
  final frame, repeated lines fold, and reads continue from a cursor.
- **You see everything.** A docked panel under the chat, a sidebar section, and a keyboard-first
  console with a real typing mode.
- **Shells outlive OpenCode.** They run in a small daemon, `cockpitd`, shared by every OpenCode
  window and upgraded automatically when the plugin updates.

## Install

```sh
opencode plugin @opencode-cockpit/shell --global
```

Restart OpenCode. Requires OpenCode 1.18 or newer on macOS or Linux.

Shell is also included in [`opencode-cockpit`](https://www.npmjs.com/package/opencode-cockpit),
which installs every cockpit feature. Install one or the other: if both are configured, the first
one loaded is used and OpenCode shows a warning.

## For the agent

| Tool | What it does |
|---|---|
| `shell_start` | Run a command in a background PTY. Optional `waitFor` blocks until a port opens, a pattern prints, output goes idle, or the process exits. Rerunning the same command in the same session reuses the shell. |
| `shell_wait` | Block on a condition instead of sleeping. |
| `shell_read` | Clean log from a cursor, with `grep`; or `view: "screen"` for full-screen programs. |
| `shell_send` | Type text or keys (`ctrl+c`, `up`, `enter`) and get the reply. |
| `shell_list` | Find shells: filter by text (`query`), `status`, `session` and `kind` (server, tests, build, watcher, task — derived from the command). |
| `shell_watch` | Watch a never-ending process and be told **only when its health changes**: "tsc: ok → 3 errors". |
| `shell_stop` · `shell_restart` | Manage shells. |

Every tool that acts on a shell takes its `id` **or its name** (the description it was started
with), so you can ask about shells naturally, including ones started in other sessions:

- *"How is DB Monitoring doing?"* → `shell_read name="DB Monitoring"`
- *"Did any shell from my other session fail?"* → `shell_list status="failed" session="others"`
- *"Which dev servers are up?"* → `shell_list kind="server" status="running"`

Names match ignoring case, then partially on name or command. If a name fits several shells the
agent gets the candidates instead of a guess.

The agent is messaged when a shell it started exits on its own.

### Watching health

`tsc --watch` and friends never exit, so re-reading their logs is the only way to know how they are
doing — and it costs tokens every time. A watcher reads the log instead and reports transitions:

```
shell_start command="tsc --watch --noEmit" description="type checker" watch=true
→ watching health (tsc)

… later, on its own:
<shell_health id="sh_9wq2f1ab" title="type checker" status="fail">
tsc: ok → fail
src/auth.ts(42,3): error TS2339: Property 'id' does not exist on type 'User'.
</shell_health>
```

Nothing is sent while a run keeps producing the same result, and a **watched process that dies is
reported as a failure**, so a crashed dev server no longer goes unnoticed.

A watch rule is three regexes, not a parser: `done` (a run ended), `fail` and `ok`. Presets ship for
tsc, eslint, biome, prettier, mypy, ruff, vitest, jest, mocha, bun test, deno test, pytest, rspec,
phpunit, playwright, cypress, vite, next, nuxt, astro, angular, webpack/rspack, esbuild, tsup,
turbo, metro, storybook, cargo, go, dotnet, gradle, maven, docker compose and terraform. Anything
else takes its own patterns, at `shell_start` or later:

```
shell_start command="./deploy.sh" description="deploy" watch={ fail: "FAILED", ok: "SUCCEEDED", idleSeconds: 5 }
shell_watch name="deploy" rule={ fail: "FAILED", ok: "SUCCEEDED", idleSeconds: 5 }
```

When no preset fits and no rule is given — `sleep 300`, a plain script, anything that prints nothing
recognizable — watching still works: the shell is watched for **dying** (preset `exit`), which is
crash detection with no patterns to write.

Things to ask:

- *"Start the dev server in a background shell and wait until it's ready."*
- *"Run the test suite in the background, keep working on the parser, tell me if it fails."*
- *"Open a node REPL in a shell and check what `new URL('..', import.meta.url)` returns."*

## For you

| Key / command | Does |
|---|---|
| `ctrl+x o` · `/shells` | Toggle the shells panel under the chat |
| `ctrl+x i` · `/shell` | Open the shell console |
| `/shell-new` | Start a shell yourself |
| `/shells-clear` | Remove finished shells |
| `/cockpit-update` | Update the plugin when a newer release exists |
| `/shells-restart-daemon` | Restart `cockpitd` (asks first when shells are running) |

Watched shells also show their health (`tsc ✓`, `vitest ✗`) in the panel, sidebar and console.

Status reads the same everywhere: `RUN` (with a spinner), `FAIL`, `STOP`, `DONE`. Running shells
and recent failures stay visible; everything else folds into `▸ N more`.

**Console keys**, and only the ones that apply right now. Running shell: `i` type (every key goes to
the program, `ctrl+]` to stop typing), `c` ctrl+c, `r` restart, `x` stop. Finished shell: `r` run
again, `d` remove. Always: `tab` screen or log, `/` search the log (`backspace` clears the filter),
`?` details, `[` `]` switch shells, `D` clear finished, `esc` close.

**Searching a long log.** In the console, `/` filters the scrollback to matching lines — keeping
their original line numbers and highlighting the match — so a 40k-line dev server is one query away
from the five lines you want. Filtering happens in the daemon, not the terminal.

**Output keeps its colours.** The panel and console paint what the program actually printed, so
`vitest`, `eslint` and friends read the way they do in a terminal.

## Configuration

Everything is optional. Settings can live in a **config file**, which is read once and applies to
both halves of the plugin — the agent's tools and the interface:

```
~/.config/opencode-cockpit/config.json   →   <project>/.cockpit.json   →   plugin-entry options
```

Later sources win key by key, so a project can override one setting without restating the rest. An
unreadable or invalid file is ignored rather than fatal: a typo should never stop shells from
working. (`XDG_CONFIG_HOME` is honoured for the global path.)

```json
{
  "kinds": { "e2e": "playwright|cypress", "infra": "^(terraform|pulumi)\\b" },
  "watch": {
    "auto": false,
    "presets": { "e2e": { "done": "\\d+ passed", "fail": "\\d+ failed", "ignoreCase": true } }
  },
  "defaults": { "logFile": true, "timeoutSeconds": 900 },
  "notify": { "exit": true, "watch": true, "tailLines": 15 },
  "guidance": true,
  "listRunningShells": 15,
  "ui": { "dockHeight": 16, "dockOpen": true, "historyMinutes": 60, "colors": true }
}
```

| Section | Meaning |
|---|---|
| `kinds` | Extra shell categories, or overrides, as name → regex matched against the command. Drives the badges in the sidebar, panel and `shell_list`, so you can group your own stack (`e2e`, `infra`, `worker`) instead of the built-ins. |
| `watch.presets` | Your own watch rules, or replacements for built-ins, keyed by name. A rule is `{ done?, fail?, ok?, idleSeconds?, ignoreCase? }` — patterns are regular expressions matched against each output line. The agent can then ask for `watch: "e2e"`. |
| `watch.auto` | Attach a matching preset to every new shell without being asked. **Off by default**: watching is useful, but silently attaching rules to commands you didn't opt in surprises people. Turn it on once you trust your presets. |
| `defaults` | Applied to every shell the agent starts unless the call says otherwise: `watch` (`true` for a matching preset, or a preset name), `logFile`, `idleTimeoutSeconds`, `timeoutSeconds`, `notifyOnExit`. |
| `notify` | What may interrupt the agent — `exit`, `watch`, and `tailLines` (output lines included in an exit message). |
| `guidance` | The system-prompt paragraph that teaches the agent when to use shells. `false` saves ~120 tokens per request, at the cost of a model that uses shells less well. |
| `listRunningShells` | How many running shells are listed in the system prompt each turn (~20 tokens each). `0` disables it; the agent can still call `shell_list`. |
| `ui` | Interface only: `dockHeight`, `dockOpen`, `sidebarRows`, `historyMinutes`, `colors`, `defaultView` (`"screen"` or `"log"`), `keybinds`, `updateCheck`. |

The same settings can go on the plugin entry instead, which is handy for one-offs and for machines
where you'd rather keep everything in `tui.json`/`opencode.json`:

```json
{
  "plugin": [
    ["@opencode-cockpit/shell", {
      "ui": { "dockHeight": 16 },
      "keybinds": { "cockpit.shells.dock": "<leader>j", "cockpit.shells.console": "<leader>k" }
    }]
  ]
}
```

`ui` keys also work spelled flat at the top level (`{ "dockHeight": 16 }`), as they did before the
config file existed. Using `opencode-cockpit` instead of the standalone package? Put the same
object under `"shell"`: `["opencode-cockpit", { "shell": { "ui": { "dockHeight": 16 } } }]`.
Interface settings must be reachable from `tui.json`, agent settings from `opencode.json` — which
is exactly why the config file exists.

| Environment variable | Default | Purpose |
|---|---|---|
| `COCKPIT_HOME` | `~/.cache/opencode-cockpit` | Socket, logs, process registry |
| `COCKPIT_IDLE_TIMEOUT_MS` | `600000` | Daemon exits after this long with no clients and no running shells |
| `COCKPIT_LOG_LEVEL` | `info` | `debug` for verbose daemon logs |

**Limits and log files** (per shell, set by the agent, or by `defaults` above):

- `timeoutSeconds` — stop it after this long, busy or not. Good for probes: *"watch the DB for two
  minutes"*.
- `idleTimeoutSeconds` — stop it after this much silence. Never use it for dev servers, which are
  idle when healthy.
- `logFile` — also write the clean log to `~/.cache/opencode-cockpit/logs/<id>.log`, so history
  survives the in-memory buffer. The path shows in the console's details view.

## Troubleshooting

| Problem | Look at |
|---|---|
| Tools fail with "did not start" | `~/.cache/opencode-cockpit/cockpitd.log` |
| Plugin not loading | newest file in `~/.local/share/opencode/log/` |
| Warning: "Shell is configured twice" | Remove either `opencode-cockpit` or `@opencode-cockpit/shell` from `opencode.json` and `tui.json` |
| Panel says the daemon runs older code | `/shells-restart-daemon` once your shells are done |

## How it works

OpenCode runs its interface and its server in separate threads, so the plugin's two halves can't
share memory. Both talk to `cockpitd`, which owns every process. Each shell's output feeds a line
normalizer (the agent's log), a headless terminal emulator (the screen you see) and a raw ring
buffer (replay for late viewers). See
[CONTRIBUTING.md](https://github.com/Codestz/opencode-cockpit/blob/main/CONTRIBUTING.md).

License: MIT
