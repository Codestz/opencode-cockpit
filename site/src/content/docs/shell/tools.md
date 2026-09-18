---
title: Agent tools
description: The nine tools the agent is given, and what each one is for.
---

Every per-shell tool takes an `id` or a `name` — the description the shell was started with. Partial
names match, and command text matches too.

## shell_start

Starts a command in a background terminal.

```json
{
  "command": "npm run dev",
  "description": "Next.js dev server",
  "waitFor": { "port": 3000 },
  "watch": true
}
```

`waitFor` blocks until the shell is actually ready — `pattern`, `port`, `idleSeconds` or `exit` —
instead of sleeping. Without it the call returns after the first moment of quiet.

`watch` takes `true` (pick a preset from the command), a preset name, or your own rule object. When
nothing matches, the shell is still watched for **dying**, which is crash detection with no patterns
to write.

## shell_read

Reads forward. `after` takes the cursor from the previous read and returns only what is new; `grep`
filters before the output costs tokens; `view` chooses the log or the screen.

## shell_wait

Blocks on a condition in an already-running shell: a pattern, a port, silence, or exit.

## shell_send

Types into a shell — text, or named keys (`enter`, `up`, `ctrl+c`) for REPLs and prompts.

## shell_watch

Attaches or changes a watcher. See [Watching health](/opencode-cockpit/shell/watching/).

## shell_list

Finds the right shell: filter by `query`, `status`, `session` or `kind`, including
[kinds you defined yourself](/opencode-cockpit/configuration/).

## shell_stop · shell_restart · shell_remove

End it, run it again with the same id, or forget it. A restart keeps the id and marks the new run in
the log, so earlier output stays readable.
