---
title: Statusline
description: A statusline for OpenCode you can actually configure — and what it deliberately refuses to say.
---

Statusline puts a line of live session state under your conversation, or a column of it in the
sidebar. Bay 02, new in 0.3.0.

![The statusline under an OpenCode conversation: a context bar at 40%, the token total with its cache, input and output parts, what is uncommitted, elapsed time and todo progress](/opencode-cockpit/media/statusline.png)

That is the default line — what you get having written no configuration at all.

## What it shows by default, and why it's so little

OpenCode's own furniture already carries a lot. Its footer has the path, the branch and the token
count. Its sidebar has the context percentage and the spend. Its prompt has the agent and the model.

A statusline that repeats those buys a second copy of something already on screen. Configured
carelessly, the context percentage can end up drawn five times in one window. So the default line is
what the host leaves out:

| Segment | Says |
| --- | --- |
| `session.status` | working, or `retry 2 in 5s` — OpenCode shows a spinner, not why it stalled |
| `git.diff` | `+150 / -30` — what is uncommitted, from `git diff --shortstat HEAD` |
| `todo` | `3/7 todo`, and nothing once the list is finished |
| `session.time` | `12m04s` |
| `diagnostics` | only when an LSP or MCP server is unhealthy |

Everything the host shows is still available as a segment — the default just doesn't assume you
want it twice.

## The rule every segment follows

**A segment with nothing to say says nothing.**

- `cost` hides itself where nobody declared prices, rather than reporting `$0.00`
- `context` hides itself where nobody declared a window, rather than inventing a denominator
- `diagnostics` is silent while every service is healthy
- `todo` goes quiet once the list is done, instead of reporting `5/5` for the rest of the session

This matters most behind a proxy, where the model catalogue knows neither prices nor a context
window. A confident `$0.00` reads as "this was free"; an absent segment reads as what it is.
See [Proxies](/opencode-cockpit/status/proxies/).

## Two surfaces

| `surface` | Where | Good for |
| --- | --- | --- |
| `bottom` | full-width line under the conversation | everything, when no sidebar is open |
| `sidebar` | the sidebar, stacked vertically by default | trends and composition — the time dimension |

There were three. The third sat inside the prompt box, which is both the narrowest place in the
window and the one OpenCode already fills with the agent, the model and the elapsed time — so a line
there had no room and nothing left to say. Two surfaces, each with a job, beat three that overlap.

## When the terminal is narrow

Every segment carries a priority. A line too wide for its surface drops the lowest-priority segments
until it fits, so how full the context is survives a 60-column window and the version string does
not. A hard right-cut would have kept whichever segments happened to sit on the left.

A vertical line drops by `maxRows` instead, and each row is cut to the column's width.

## Keys and commands

The statusline has no keys, and that is deliberate: it is something you read, not something you
drive. Nothing it does needs a keystroke, so it takes none — a line that claimed a letter you could
have given to a bay you actually operate would be charging you for the privilege of being looked at.

| Command | Does |
| --- | --- |
| `/statusline` | Hands the agent a brief on your line: which config file this project reads, what is in it, and anything that failed to load |

`/statusline` writes into the conversation rather than opening a panel, because the useful next step
is usually "change this for me", and the agent needs to know what it is changing.

## Three ways to configure it

Use the first that fits.

1. **[Declarative segments](/opencode-cockpit/status/configuration/)** in `config.json` or
   `.cockpit.json`. No code, no subprocess.
2. **[Your own TypeScript](/opencode-cockpit/status/modules/)**, for a segment that has to read the
   session and decide — or remember what it saw a minute ago.
3. **[A shell command](/opencode-cockpit/status/commands/)**, fed the same JSON Claude Code's
   `statusLine` hook sends, so a script you already wrote works unchanged.

## Install

```sh
opencode plugin @opencode-cockpit/status@0.5.1 --global --force
```

Or get it with every other bay through the `opencode-cockpit` bundle.
