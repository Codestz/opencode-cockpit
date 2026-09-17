# @opencode-cockpit/daemon

`cockpitd`, the long-lived process host. Owns PTY shells (each its own process group), normalizes output into clean logs, emulates the screen, implements wait conditions, reaps orphans after crashes and shuts down when idle. Capabilities are modules with a namespace, a method table and a lifecycle.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install the plugin, not this package, unless you are building your own front end:

```sh
opencode plugin opencode-cockpit --global
```

Requires Bun ≥ 1.3.5 (OpenCode's embedded runtime qualifies). License: MIT.
