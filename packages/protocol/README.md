# @opencode-cockpit/protocol

**The contract between `cockpitd` and everything that talks to it.** Zod schemas for every method
and event, the types generated from them, the socket paths, the framing, and the build identity used
to decide which daemon should be running.

Client and daemon import the *same* file, so a change to a shape is a compile error on both sides
rather than a runtime surprise in one of them.

> Installing the plugin is what you usually want. This package matters if you are writing a
> capability, or a client of your own.

---

## What is in it

| Export | What it gives you |
| --- | --- |
| `contract`, `Methods`, `MethodName` | Every method, its params and its result |
| `events`, `Events`, `Topic` | Every event topic and its payload |
| `PROTOCOL_VERSION` | `{ major, minor }` — the wire version |
| `shell` | The shell capability's schemas: `ShellInfo`, `StartParams`, `WatchRule`, `ReadResult`, … |
| `resolvePaths`, `CockpitPaths` | Where the socket, logs and registry live |
| `daemonBuildId` | Content identity of a daemon build |
| `encodeFrame`, `decodeFrames` | NDJSON framing |
| `RpcError`, `ErrorCode` | The error shape both sides speak |

## The shape of a call

```ts
import { contract, shell } from "@opencode-cockpit/protocol"

// Every method is params → result, both zod schemas:
contract["shell.start"].params   // StartParams
contract["shell.start"].result   // ShellInfo

// Schemas are usable on their own, so a UI can parse what it receives:
const info = shell.ShellInfo.parse(payload)
```

Requests and responses are JSON-RPC 2.0, one object per line (NDJSON) over a unix socket. Events are
notifications, delivered only to peers subscribed to the topic.

## Versioning

`PROTOCOL_VERSION` is `major.minor`:

- **Minor** goes up when something is added — a new method, a new optional field. Old clients keep
  working, so a daemon may serve a client that predates the addition.
- **Major** goes up when something existing changes meaning or disappears. A mismatch is refused at
  the handshake with a message naming both versions, instead of failing halfway through a call.

The handshake carries the version, so both ends know where they stand before any work starts.

## Build identity

```ts
import { daemonBuildId } from "@opencode-cockpit/protocol"

daemonBuildId(entry, version) // → "0.2.1+4eac93214393"
```

A hash of the daemon's own files plus its version. Equal versions with different hashes are how a
development build is recognised as newer than the daemon already running — which is what lets a
plugin under active work replace an idle daemon without a version bump.

## Adding a method

1. Add the schema to the capability's contract file (`src/shell/contract.ts`, or a new namespace).
2. Bump `PROTOCOL_VERSION.minor`.
3. Implement the handler in the daemon module — it is typed from the contract, so a missing or
   mis-shaped handler will not compile.
4. Call it from the client. No client-side wiring: `call` picks up the new name.

Schemas are split by concern rather than piled into one file — for shell that is `common`, `info`,
`params`, `watch` and `contract` — so a capability's surface stays readable as it grows.

## Requirements

Bun ≥ 1.3.5 or Node ≥ 20 for the schemas alone. Runs anywhere zod runs.

## More

[Architecture](https://codestz.github.io/opencode-cockpit/platform/architecture/) ·
[Daemon](../daemon) · [Client](../client) ·
[Repository](https://github.com/Codestz/opencode-cockpit)

MIT
