# @opencode-cockpit/protocol

Wire protocol for cockpitd: JSON-RPC 2.0 over NDJSON on a unix socket. Zod schemas for every method and event, error codes, filesystem layout and the daemon build id. No runtime I/O beyond path and hash helpers.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install the plugin, not this package, unless you are building your own front end:

```sh
opencode plugin opencode-cockpit --global
```

Requires Bun ≥ 1.3.5 (OpenCode's embedded runtime qualifies). License: MIT.
