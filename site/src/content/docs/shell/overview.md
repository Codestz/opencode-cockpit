---
title: Shell
description: Background terminals with a real PTY — what they are for and when to use one.
---

Shell gives the agent terminals that keep running: dev servers, watchers, test suites, REPLs,
tunnels, tails. Bay 01, shipping since 0.1.0.

## When a shell beats bash

| The task | In a tool call | In a shell |
| --- | --- | --- |
| Start a dev server | Blocks until killed, or is backgrounded and lost | Returns when the port answers, keeps running |
| Watch a type checker | Re-read the whole log every turn | One message when it breaks, one when it is fixed |
| A REPL | One-shot; state gone by the next call | Stays open, takes input later |
| A crash | Noticed when something else fails | Reported as a failure when it happens |
| A prompt, a wizard, ctrl+c | Not possible: no TTY | A real PTY: it answers prompts and takes keys |
| OpenCode restarts | Gone | Still running |

Rule of thumb: **anything that would still be running when the turn ends belongs in a shell.**

## Three views of one stream

Every shell's output is kept three ways at once, and each has a job:

- **Log** — normalised, numbered lines for the agent. Colour codes are stripped, carriage returns and
  progress bars collapse to their final state, and repeated lines fold to `(×12)`, so a spinner costs
  one line instead of ten thousand.
- **Screen** — an emulated terminal, which is what you see in the panel. `vitest` looks like
  `vitest`.
- **Raw ring** — the bytes, so a panel opened late can replay what it missed.

## When a shell ends

The agent doesn't have to poll. When a background shell exits, it is told once, with the line that
matters already picked out:

```
<shell_exited id="sh_9wq2f1ab" title="unit tests">
exited with code 1 after 48s
last output: 37| FAIL src/auth.test.ts > refresh token expiry
```

## Limits

- `timeoutSeconds` — stop it after this long, busy or not. Good for probes: *watch the DB for two
  minutes*.
- `idleTimeoutSeconds` — stop it after this much silence. Never use it for dev servers, which are
  idle when healthy.
- `logFile` — also write the clean log to `~/.cache/opencode-cockpit/logs/<id>.log`.

Whatever ends a shell is recorded, so the summary says *why*: a time limit, an idle limit, the agent,
you, or a crash with its exit code.
