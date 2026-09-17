# @opencode-cockpit/client

Typed client for cockpitd. Starts the daemon when needed (one per machine, even under concurrent first calls), reconnects and restores subscriptions, replays read-only calls after a lost connection, and replaces a daemon running outdated code when it is idle.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install the plugin, not this package, unless you are building your own front end:

```sh
opencode plugin opencode-cockpit --global
```

Requires Bun ≥ 1.3.5 (OpenCode's embedded runtime qualifies). License: MIT.
