# @opencode-cockpit/client

**The typed client for `cockpitd`.** Connects, and if nothing is listening, starts the daemon first.

Every half of every Cockpit plugin talks to the daemon through this: the agent tools in OpenCode's
server thread, and the panel in its interface thread. It hides the parts that are easy to get wrong —
spawning, reconnecting, version skew, subscriptions — so a capability is left writing calls.

> Installing the plugin is what you usually want. This package matters if you are building your own
> front end for Cockpit, or a capability of your own.
>
> ```sh
> opencode plugin opencode-cockpit@0.5.2 --global --force
> ```

---

## Using it

```ts
import { CockpitClient } from "@opencode-cockpit/client"

const client = new CockpitClient({
  client: { name: "my-tool", version: "1.0.0", pid: process.pid },
  spawn: { entry: daemonEntry(), execPath: process.execPath },
})

const shell = await client.call("shell.start", {
  command: "npm",
  args: ["run", "dev"],
  cwd: process.cwd(),
  owner: { project: process.cwd(), session: "sess_1" },
})

await client.call("shell.wait", { id: shell.id, until: { port: 5173 }, timeoutMs: 30_000 })
const page = await client.call("shell.read", { id: shell.id, tail: 20 })
console.log(page.lines.map((l) => `${l.n}| ${l.text}`).join("\n"))
```

`call` is typed end to end from the protocol contract: the method name completes, the params are
checked, and the result comes back with its real shape. An unknown method is a compile error, not a
runtime surprise.

## Events

```ts
const off = client.on("shell.exited", (info) => {
  console.log(`${info.id} ended: ${info.status}`)
})
// …later
off()
```

Subscriptions are restored automatically after a reconnect, so a dropped socket does not silently
stop the messages.

## Starting the daemon

Pass `spawn` and the client starts `cockpitd` when nothing is listening, waits for the socket, and
connects. A lock file keeps two clients racing at the same moment from starting two daemons.

Inside OpenCode, `process.execPath` is the OpenCode binary rather than Bun, so the client runs the
daemon with `BUN_BE_BUN=1` against OpenCode's embedded runtime — no separate Bun install.

## Version skew

The daemon is long-lived and shared, so the code running inside it can be older than the plugin that
just connected. `expectedBuild` is the build id of the daemon code shipped with your package:

```ts
import { daemonBuildId } from "@opencode-cockpit/protocol"

new CockpitClient({
  client: { name: "my-tool", version: pkg.version },
  spawn: { entry, execPath: process.execPath },
  expectedBuild: daemonBuildId(entry, daemonPkg.version),
})
```

- **Newer client, idle daemon** — the daemon is replaced silently.
- **Newer client, busy daemon** — kept, and reported through `onOutdated` so you can say so and offer
  a restart. Running shells are never killed to make an upgrade convenient.
- **Older client** — connects as-is. Upgrades only go forward, or two versions would take turns
  replacing each other.

```ts
client.onOutdated((info) => {
  if (info) console.warn(`daemon runs ${info.running}, this build expects ${info.expected}`)
})
await client.restartDaemon() // when the user is ready
```

## One capability, loaded twice

A capability can arrive through the bundle and on its own at the same time. `claimFeature` makes the
first one win and gives the second a message worth showing:

```ts
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"

const claim = claimFeature("shell", "opencode-cockpit")
if (!claim) return console.warn(duplicateFeatureMessage("shell"))
// …later
claim.release()
```

## API

| Export | What it is |
| --- | --- |
| `CockpitClient` | The client: `call`, `on`, `onOutdated`, `onState`, `restartDaemon`, `close`, `daemon` |
| `CockpitClientOptions` | `client`, `paths`, `spawn`, `expectedBuild` |
| `OutdatedDaemon` | `{ running, expected }` |
| `compareBuilds` | Orders two build ids; equal versions with different hashes count as newer |
| `claimFeature`, `duplicateFeatureMessage`, `FeatureClaim` | First-one-wins guard for duplicate loads |
| `SpawnOptions` | `entry`, `execPath`, `env` |

## Requirements

Bun ≥ 1.3.5. macOS and Linux.

## More

[Architecture](https://codestz.github.io/opencode-cockpit/platform/architecture/) ·
[Daemon](../daemon) · [Protocol](../protocol) ·
[Repository](https://github.com/Codestz/opencode-cockpit)

MIT
