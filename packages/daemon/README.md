# @opencode-cockpit/daemon

**`cockpitd` — the process host that everything else in Cockpit talks to.**

OpenCode runs its interface and its server in separate threads that cannot share memory, and neither
survives a restart. Anything long-lived — a process, a watcher, a subscription — has nowhere to
live. This package is that home.

One daemon per machine, shared by every OpenCode window, started on demand and gone when idle.

> Installing the plugin is what you usually want. This package matters if you are building your own
> front end, writing a capability, or debugging the daemon itself.
>
> ```sh
> opencode plugin opencode-cockpit@0.5.2 --global --force
> ```

---

## What it does

| | |
| --- | --- |
| **Owns processes** | Every shell runs in a real PTY as its own process group, so a stop kills the children too |
| **Normalizes output** | Carriage returns, progress bars and cursor moves collapse into clean numbered lines |
| **Emulates a screen** | A headless terminal keeps what a human would see, for the interface |
| **Answers conditions** | Wait for a port, a pattern, silence or exit — without polling |
| **Watches health** | Rules turn an endless log into transitions: ok → fail, and back |
| **Cleans up** | Process groups are recorded, so a daemon that starts after a crash reaps what was left |
| **Gets out of the way** | Exits after ten idle minutes with no clients and nothing running |

## Running it

Normally the client spawns it for you. To run it by hand:

```sh
bun packages/daemon/src/main.ts
# or, from an installed plugin, on OpenCode's embedded runtime:
BUN_BE_BUN=1 "$(which opencode)" node_modules/@opencode-cockpit/daemon/dist/main.js
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `COCKPIT_HOME` | `~/.cache/opencode-cockpit` | Socket, logs, process registry, per-shell log files |
| `COCKPIT_IDLE_TIMEOUT_MS` | `600000` | Time with no clients and nothing running before it exits; `0` never exits |
| `COCKPIT_LOG_LEVEL` | `info` | `debug` for verbose logs |

The socket lives at `$COCKPIT_HOME/cockpitd.sock`, mode `0600`, inside a `0700` directory. Logs go to
`$COCKPIT_HOME/cockpitd.log` as one JSON object per line.

## How a capability plugs in

A capability is a **module**: a namespace, a typed method table, and a lifecycle. The daemon owns
connections, framing, validation, subscriptions and shutdown; the module owns its own state.

```ts
import type { Module, ModuleContext, MethodTable } from "@opencode-cockpit/daemon"

export class ClockModule implements Module<"clock"> {
  readonly name = "clock" as const
  private timer: ReturnType<typeof setInterval> | undefined
  private emit: ModuleContext["emit"] = () => {}

  readonly methods: MethodTable<"clock"> = {
    // Params are already parsed and typed from the protocol contract.
    now: () => ({ iso: new Date().toISOString() }),
  }

  async start(ctx: ModuleContext) {
    this.emit = ctx.emit
    this.timer = setInterval(() => this.emit("clock.tick", { at: Date.now() }), 1000)
    ctx.log.info("clock started")
  }

  async stop() {
    clearInterval(this.timer)
  }

  /** While this is true the daemon refuses to shut down for idleness. */
  busy() {
    return false
  }
}
```

Methods are named `<namespace>.<method>` and their shapes come from
[`@opencode-cockpit/protocol`](../protocol) — add the contract there first and the handler is typed
for you. Events are broadcast to peers that subscribed to the topic.

## Transport

JSON-RPC 2.0 over NDJSON on a unix socket. One line per message, requests and responses correlated
by id, plus server-initiated notifications for events.

Each build has an id derived from the daemon's own code. When a client connects carrying a **newer**
build than the running daemon, and nothing is busy, the daemon shuts down so the newer one can take
over. If work is in flight it stays, and the client is told — nothing is killed behind your back.
Only forwards: an older client never replaces a newer daemon.

## Public API

| Export | Use |
| --- | --- |
| `Daemon`, `DaemonOptions` | Construct and run a daemon with your own module set |
| `createModules`, `ModuleOptions` | The modules that ship with Cockpit |
| `Module`, `ModuleContext`, `MethodTable`, `CallContext`, `Peer` | Types for writing one |
| `ShellModule`, `ShellModuleOptions` | The shell capability, if you want it on its own |
| `PtyBackend`, `PtyProcess`, `PtySpawnOptions` | Swap the PTY implementation, e.g. in tests |

```ts
import { Daemon, createModules } from "@opencode-cockpit/daemon"
import { resolvePaths } from "@opencode-cockpit/protocol"

const daemon = new Daemon({
  paths: resolvePaths(),
  modules: createModules({ shell: { maxFinished: 50 } }),
  idleTimeoutMs: 600_000,
})
await daemon.start()
```

## Requirements

Bun ≥ 1.3.5 — OpenCode's embedded runtime qualifies, so no separate install. macOS and Linux.

## More

[Architecture](https://codestz.github.io/opencode-cockpit/platform/architecture/) ·
[Repository](https://github.com/Codestz/opencode-cockpit) ·
[Contributing](https://github.com/Codestz/opencode-cockpit/blob/main/CONTRIBUTING.md)

MIT
