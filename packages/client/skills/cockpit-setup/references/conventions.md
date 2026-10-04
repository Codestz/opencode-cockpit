# Cockpit conventions: what goes in the section

The section is a project's (or a person's) **conventions**, in the agent's terms: which command is the
dev server, what a ticket key looks like. It never explains how to use a bay — every request already
carries each bay's guidance, and a second copy in AGENTS.md only goes stale.

Short imperative lines, one fact each, grouped by bay with a bold label. Only the bays they have on,
only what they told you. Hand `cockpit_conventions` the lines below the heading: the tool adds the
heading and the markers.

## Shell — the commands that keep running

One line per long-running command: the exact command, the description that names the shell (the
agent and the person find it again by that), and when to start it:

```markdown
**Shells**
- Start the dev server with `bun run dev` as a background shell described "dev server". Reuse it if it is already running; never start a second one.
- Run the tests with `bun run test:watch` as a background shell described "test watcher". Read its output instead of running the suite again.
- Start the database with `docker compose up db` as a background shell described "database", before anything that needs it.
```

Add `with watch: true` to a line when they want to hear when a run passes or fails: the Shell picks a
matching rule for 35 common tools (vite, next, vitest, jest, tsc, playwright, docker-compose, cargo,
go…). Only for a tool none of them fits, offer a rule of their own in Cockpit's settings — the
`shell.watch.presets` key, `{ "<name>": { "done": "<regex>", "fail": "<regex>" } }`, written with the
rest of the settings file — and name it in the line: `with watch: "e2e"`.

## Trail — tickets, repos, names

```markdown
**Trail**
- Tickets are Jira keys like `COM-1736`. When a PR, branch or page is for a ticket, put its key in `for`.
- Pull requests go to `github.com/acme/web` and `github.com/acme/api`.
- Name branches `<ticket>-<short-slug>`, e.g. `COM-1736-login-redirect`.
```

The `for` line is the one that matters: it is what groups the trail by ticket. Several prefixes
(`COM-…`, `ENG-…`) go in one line. Leave out a line they have no answer for.

## Subagents — how they like work split

Only when they have a preference; the default guidance already covers how to launch and wait:

```markdown
**Subagents**
- Explore the codebase in background subagents and keep this conversation free for me.
```

or

```markdown
**Subagents**
- Do not use subagents unless I ask; work in this conversation.
```

## A whole section

```markdown
**Shells**
- Start the dev server with `bun run dev` as a background shell described "dev server". Reuse it if it is already running.
- Run the tests with `bun run test:watch` as a background shell described "test watcher", with watch: true.

**Trail**
- Tickets are Linear keys like `ENG-412`. When a PR is for a ticket, put its key in `for`.
```

## Not here

- How to use a bay's tools (`shell_start`, `trail_add`, `subagents_wait`): already in every request.
- Cockpit's settings (sidebar, keys, `hideWhenEmpty`): those go in Cockpit's settings file.
- Anything they did not say. A guessed convention is worse than none.
