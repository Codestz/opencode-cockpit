# @opencode-cockpit/trail

**What a conversation made.** The pull requests, tickets, pages and deploys your agent created or
changed — kept per conversation, grouped by the ticket they were for, and one click from the page.
And the other way round: which conversation opened PR #33, and a jump back into it.

<img src="https://raw.githubusercontent.com/Codestz/opencode-cockpit/main/media/trail.gif" width="760" alt="/trail: this conversation's records, then every conversation in the project and which one made each">

*Drawn by the bay's own renderer — the same code that runs in your terminal.*

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle, where it is on by default (`features.trail: false` turns it off). Works on
OpenCode 1.18+ and 2.0.15+.

```sh
opencode plugin @opencode-cockpit/trail@0.10.1 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/trail@0.10.1                   # OpenCode 2
```

**Setup: none.** No account, no token, no list of tools to configure. The agent already knows what
it just did, with whatever it uses — `gh`, an MCP server, a company CLI — so the agent writes the
trail, and Trail keeps it. It has no GitHub or Jira client and stores no credentials.

## How things get into the trail

- **The agent records them** with `trail_add`, right after it creates or changes something outside
  the repository's files. It is told so in its system prompt on every request, subagents included.
- **A safety net, never automatic.** When the output of something the agent *ran* — a shell command,
  an MCP call — holds a PR or issue link it has not recorded, its next request says so, as a choice:
  *seen in output — record it if you created or changed it*. Links in files it read or pages it
  fetched are ignored. Nothing is ever added without the agent or you.
- **You add one** with `/link` (the palette's "Add a link to this conversation's trail"), then
  paste the link, and a note if you like.

The system comes from the link, not from a list: github.com is GitHub, `…atlassian.net/browse` is
Jira, `…/wiki` Confluence, claude.ai Claude, linear.app Linear, anything else its domain. Query
parameters that look like secrets (`token`, `sig`, signed-URL parameters…) are dropped before
anything is stored, and only `http(s)` links are ever opened.

## In the sidebar

On by default, after Shells:

```
Trail                              9

COM-1801
  a1b2c3d  Bump the prot…  12m ago
  ENG-42   Retry the soc…  15m ago ↗
COM-1736   Bundle desync    2h ago ↗
  PR #33   0.8: Trust, o…   1h ago ↗
  PR #12   Landing: Trus…   2h ago ↗
+ 4 more · /trail
```

What this conversation made, grouped by what it was for, newest work first. A row is the thing's
ref (a record without one gives its title that column), its title, its system, what this
conversation last did and when (`now`, `12m ago`; a narrow sidebar drops the system first, then the
"ago") — history, not a status: a
PR's state belongs to GitHub, and a trail that said "open" for a merged PR would be worse than none.
**Click a row with `↗` to open the page**; one without a page opens `/trail` on it; `+ N more` opens
`/trail`. Empty, the block says `none yet`.

## `/trail`

`/trail`, `ctrl+x f` or the palette: **This conversation** and **All conversations** in this project
(`tab`), grouped the same way, with every conversation that touched a thing listed under it.

| key | |
| --- | --- |
| `enter` | open the page |
| `g` | go to the conversation that made it (its root, naming the subagent that did) |
| `c` | copy the link |
| `x` | remove it from the trail |
| `m` | copy the trail as a markdown list — for a PR description, a standup, a ticket |
| `/` | search title, ref, kind and system (`jira`, `COM-1736`) |
| `esc` | close |

A conversation since deleted keeps its records, marked as such, under the title it had.

## The agent's tools

| tool | |
| --- | --- |
| `trail_add` | `title`, and `url` or `ref`; optional `kind`, `action`, `for`, `note`, all free text. The same link again updates the record — its actions become a history (`created → updated`) — never a second row. |
| `trail_list` | This conversation's trail, or with `all` every conversation in the project and which one made each; `query` filters. The same facts and order as `/trail`. |

What the conversation produced is rebuilt into its system prompt on every request from the trail
itself, so the agent still knows after the conversation is compacted.

## Settings

In `~/.config/opencode-cockpit/config.json`, or a project's `.cockpit.json`:

```jsonc
{
  "trail": {
    "enabled": true,        // the off switch; features.trail: false works too
    "sidebar": true,        // draw the block
    "sidebarRows": 5,       // records before "+ N more"
    "hideWhenEmpty": false, // no block at all until there is something to show
    "keybinds": { "cockpit.trail.open": "<leader>f" }
  }
}
```

Where the block sits is the top-level `"sidebar"` list's to say
(`["status", "subagents", "shell", "trail", "trust"]` by default). A setting Trail cannot use is
drawn in the block as a `!` row with what to do.

## Team conventions (optional)

Trail works with nothing in your repository. If your team names things a certain way, a few lines in
`AGENTS.md` shape the records — they do not make them happen. `/cockpit-setup`'s second phase offers
your ticket prefix, read from your branch names and commits, and writes it there for you; or by hand:

```md
## Trail
- Tickets are Jira keys like COM-1234: pass the PR's ticket as `for`.
- Put the Confluence space in a page's title: "WEB · Release notes 0.8".
- Record deploys with kind "deploy" and the environment in the title.
```

## Where it keeps things

One append-only file per project, outside it:
`~/.local/share/opencode-cockpit/trail/<project>-<hash>/events.ndjson` (`$XDG_DATA_HOME`, or
`$COCKPIT_HOME`). Every window and the agent append to it; nothing is ever rewritten.

## See it without OpenCode

```sh
bunx @opencode-cockpit/trail preview            # the sidebar and /trail, from sample trails
bunx @opencode-cockpit/trail preview --text     # and what the agent reads
```
