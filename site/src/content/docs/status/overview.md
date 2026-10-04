---
title: Statusline
description: A statusline for OpenCode you can actually configure — and what it deliberately refuses to say.
---

Statusline puts a column of live session state at the top of the sidebar, or a line of it under
your conversation. Bay 02, new in 0.3.0.

## What it shows by default, and why

With no configuration at all, a table in the sidebar:

```
Status
████████████████
tokens 85.2k · 43%
in     265 · 0%
out    60 · 0%
cache  84.9k · 100%
──────────────
spend  $26.24
avail  $173.76 · 87% left
──────────────
git    5f +312 -48
```

The `sidebar` preset, and the default since 0.9: how full the window is as one solid bar, the tokens
broken into named rows with their share of it, a proxy's budget, and what is uncommitted — the work
not saved anywhere yet (`"against": "branch"` counts the whole branch instead). A retry shows under
the bar; the turn's own clock does not, OpenCode already shows one. Every number gets a word, in a
fixed column so the figures line up; colour is a level (calm, then the warning, then the error),
never a label. A row with nothing to say is not drawn: `write` with no cache writes, `spend` and
`avail` with no proxy writing a budget ([Proxies](/opencode-cockpit/status/proxies/)),
`diagnostics` while every MCP and language server is healthy (`! name` in red when one breaks). It sits
beside OpenCode's own Context block; to keep only one, see
[Replacing OpenCode's own sidebar blocks](/opencode-cockpit/status/configuration/#replacing-opencodes-own-sidebar-blocks).

### At the bottom instead

`{ "status": { "sidebar": false } }` — or `"surface": "bottom"` — draws the `default` line under the
conversation:

![The statusline under an OpenCode conversation: a context bar at 40%, the token total with its cache, input and output parts, what is uncommitted, elapsed time and todo progress](/opencode-cockpit/media/statusline.png)

OpenCode's own furniture already carries a lot. Its footer has the path, the branch and the token
count. Its sidebar has the context percentage and the spend. Its prompt has the agent and the model.

The bottom line repeats one of those on purpose — the token count and the percentage — because it
says them better: a bar you read without looking, with the total's parts beside it, is a different
instrument from `78.5K (39%)` in a corner. What stays out are the facts a second copy adds nothing
to: the path, the branch, the model, the spend.

| Segment | Says |
| --- | --- |
| `context` | `▐█████▉········▌ 43%` — how full the window is |
| `tokens` | `tk 85.2k │ cache 84.9k │ in 265 │ out 60` — the total, then what it is made of |
| `git.diff` | `+150 / -30` — what is uncommitted, from `git diff --shortstat HEAD` |
| `session.time` | `took 3m42s` — how long the last answer took; quiet while one is running |
| `todo` | `3/7 todo`, and nothing once the list is finished |
| `session.status` | `working 1m02s`, or `retry 2 in 5s` — OpenCode shows a spinner, not why it stalled |
| `diagnostics` | only when an LSP or MCP server is unhealthy |

Words are the labels, muted, and the figures are in the text colour; colour is kept for what it
signals — the bar's level (calm, the warning from 75%, the error from 90%), what was added and
removed, a retry. A part that is zero, such as `cache` on a provider with no prompt cache, is left
out rather than drawn as `cache 0`.

Everything else is one line of config away — including the things the host shows, if you want them
in both places.

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
| `sidebar` | the sidebar, stacked vertically — the default | a table: every figure with its word |
| `bottom` | full-width line under the conversation | everything, when no sidebar is open |

There were three. The third sat inside the prompt box, which is both the narrowest place in the
window and the one OpenCode already fills with the agent, the model and the elapsed time — so a line
there had no room and nothing left to say. Two surfaces, each with a job, beat three that overlap.

## When the terminal is narrow

Every segment carries a priority. A line too wide for its surface drops the lowest-priority segments
until it fits, so how full the context is survives a 60-column window and the version string does
not. A hard right-cut would have kept whichever segments happened to sit on the left.

A column drops by `sidebarRows` instead (a line's own `maxRows`), says how many with a `↳ N more`
row, and cuts each row to the column's width.

## Keys and commands

The statusline has no keys, and that is deliberate: it is something you read, not something you
drive. Nothing it does needs a keystroke, so it takes none — a line that claimed a letter you could
have given to a bay you actually operate would be charging you for the privilege of being looked at.

| Command | Does |
| --- | --- |
| `/status-setup` | The agent sets your line up with you, with the `status-setup` skill that ships with Status: a preset to start from, the segments, the sidebar or the bottom, and the preview before it is called done |
| `/cockpit-setup` | The same for every bay at once: which show, where, in what order — see [Configuration](/opencode-cockpit/configuration/) |

`/status-setup` asks the agent rather than opening a panel, because the useful next step is usually
"change this for me". The skill reads what is written now with `cockpit_settings`, so it knows what
it is changing; asking in plain words ("put the statusline at the bottom") loads it too. From the
home screen it opens a conversation. `/statusline`, its name until 0.9, still works for one release
and says the new name.

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
opencode plugin @opencode-cockpit/status@0.9.0 --global --force
```

Or get it with every other bay through the `opencode-cockpit` bundle.
