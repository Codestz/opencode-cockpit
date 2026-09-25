# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Subagents: see what your subagents are doing, while they do it.** A new bay,
  `@opencode-cockpit/subagents`, also in the bundle. The sidebar lists every subagent of the
  conversation with what it is doing now (`grep "session" src/auth/**  51s`); a click — or
  `ctrl+x w`, or `/subagents` — opens it in a pane, half the window or all of it: model and launcher,
  the task, then its run — each tool call one line that opens to its arguments and output the way
  OpenCode draws its own, thinking folded, the answer drawn as markdown. `j`/`k` move through it,
  `enter` or a click opens an item, `i` shows details. `m` writes to it at the foot of the pane: mid-run it picks the message up and says so in its
  answer. The main agent is asked to launch independent subagents in the background so the
  conversation keeps going — built into OpenCode 2; on OpenCode 1 with
  `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`. Everything measured on both versions.

- **Stop a subagent, or clear finished ones.** In the pane, `x` twice stops a working subagent;
  on a finished one `x` removes it from the list, and `X` removes every finished one. The palette
  has "Clear finished subagents" and "Show removed subagents again".
- **The sidebar reads statusline, subagents, shells — and one list reorders it.**
  `{ "sidebar": ["shell", "status", "subagents"] }` in `~/.config/opencode-cockpit/config.json`
  (or a project's `.cockpit.json`); a bay's own `sidebarOrder` still wins. OpenCode 2 now keeps the
  same order as OpenCode 1 (it drew slots in the order they registered), and the statusline's and
  Shell's places at the foot of the window no longer move with their sidebar place.
- **Move a subagent to the background from its pane** (`b`), as OpenCode's `ctrl+b` does.
- **Follow-ups keep a subagent's context.** The main agent is asked to continue the subagent that did
  the work rather than launch a new one, and gets a `subagents_list` tool (id, task, state, last
  answer). When you message a finished subagent directly, its answer is added to the main
  conversation without starting a turn, so the main agent knows. Rounds show in the pane and the
  sidebar.
- **`hideFinishedAfter`** takes finished subagents out of the sidebar after that many minutes.
- **Paste works in Cockpit's text fields** — a subagent message, Shell's search, and the shell you
  are typing into. A paste arrives as one event, not keys, and went to OpenCode's prompt instead.
- **Big outputs stay easy to move through.** A folded call shows 10 lines of its output, an open
  one 60, and `a` shows it whole (up to 2,000). Scrolling inside a selected call no longer snaps
  back to its first line.
- **Stopping a subagent tells the main agent why**, so it reports the stop instead of relaunching it.

### Fixed

- **A prompt dialog with a plain-text description stopped OpenCode 1** ("Orphan text error"). The
  shared host now hands plain text to OpenCode 1's dialog as an element.
- **OpenCode 2's event stream, once closed, stayed closed**, so shells of sessions deleted afterwards
  stayed until restart. It is opened again, with a backoff.
- `doctor` counts a daemon owned by another user as running; `bun run dev:install` leaves an install
  that `npm install` works in.

## [0.6.0] - 2026-09-24

### Added

- **Cockpit runs on OpenCode 2.** Every package now loads on OpenCode 1.18+ and 2.0.15+ from the
  same entry: the panels, console, Review, statusline and updater in the interface, and the `shell_*`
  and `review_*` tools, system guidance and exit notifications on the agent side. Each bay is written
  once against a host (`@opencode-cockpit/client/host` and `/server`) that each version supplies. On
  OpenCode 2, `/plugins-update` says to change the version in `opencode.json`: the updater edits
  OpenCode 1's files only.

- **One log for everything Cockpit does inside OpenCode.** Both halves of every bay write JSON lines
  to `~/.cache/opencode-cockpit/cockpit.log`, beside the daemon's `cockpitd.log`: which OpenCode
  (v1 or v2, and its version) loaded which entry, every error with its stack — including ones that
  used to be a toast and nothing else — and every tool that failed. `COCKPIT_DEBUG=1 opencode` adds
  the detail (console actions, each tool call and how long it took) and turns the daemon's debug
  lines on too. The file moves to `cockpit.log.1` past 5 MB.

- **`npx opencode-cockpit@latest doctor`.** Checks a setup and prints the fix for anything wrong,
  for the OpenCode you have: its version; every Cockpit entry in `opencode.json`, `tui.json` and
  `cli.json` in either OpenCode's spelling — a bay configured twice, a half missing on OpenCode 1, a
  pin older than the newest release, a checkout OpenCode 2 cannot load; what the log says last ran,
  and on which OpenCode; recent errors; the daemon; `git` and `ps`; settings files and statusline
  modules. Runs under Node outside OpenCode, so it works when Cockpit will not load. `--json` for an
  issue; exits 1 when something must be fixed.

### Changed

- `createShellServer` and `createReviewServer` return a feature for `dualServer` rather than a v1
  plugin function.

### Fixed

- **Full-screen shell console and the Review pane were see-through on transparent themes.** A theme
  that leaves its background transparent (OpenCode's "system" theme, which shows the terminal's own)
  painted the full-window surface with nothing, and the conversation showed through it. They now use
  the first opaque background the theme has, and a solid one when it has none.

## [0.5.2] - 2026-09-24

### Added

- **Review reads like a pull request: every file in one scroll.** Each changed file is a card with a
  heading you can fold — path, `+/−`, its notes, `+ note` and `[ ] viewed` — and the heading of the
  file you are in stays pinned at the top. Marking a file viewed folds it and moves to the next
  unviewed one (below, or the nearest above — never back to the start); `z` or `enter` folds by hand;
  very large diffs start folded. Headings are clickable. Only what is on screen is drawn: a
  two-hundred-file review scrolls at under a millisecond a frame, and each diff is worked out once.
  The file list follows the diff as you scroll.
- **Review compares a stacked branch with the branch it grew from.** On `main ← feature ← X`, branch
  mode used to compare X with `main` and mix in every commit of `feature`; a stale local `main` mixed
  in work already merged. It now finds the nearest parent — the branch X has the fewest commits
  beyond — the way a pull request from X into `feature` reads. `B` picks another base, remembered per
  branch.
- **Shell console full screen (`w`).** The same console over the whole window — output, details,
  search, every key — remembered for next time; `w` again for the dialog.
- **Scroll back through a shell's screen.** `j`/`k` (or the wheel in full screen) scroll the screen
  view through the terminal's history, not only the plain log; `G` follows the output again.
- **Finished agent shells clean themselves up.** `lifecycle.removeFinishedAfterMinutes` (30 by
  default, `0` keeps them) removes a shell the agent started that long after it exits cleanly. Failed
  or killed shells stay until `/shells-clear`: those are the ones worth reading.
- **Watchers look like watchers.** A watched shell says `watch tsc …` from the start — it used to look
  like any other shell until its first run finished — and `/shells` groups them under *Watching*.

### Changed

- **`/shells` is a list:** every shell in the project, grouped by what needs attention, with "New
  shell" first. The dock moved to `/shells-dock` (`ctrl+x o` unchanged); `/shell` still reopens the
  last console.
- **The pane without the cursor is dimmed less.** It blended into the background far enough to read as
  disabled; it is now a gentle step back.
- **`B` is in Review's key row**, and the shell console dialog is centred on screen.

### Fixed

- **Clicks in the Review pane landed one row off**, and `+ note` on a heading closed its own dialog on
  mouse release.
- **Opening the shell console while it was already open** left a dialog that `esc` could not close.

## [0.5.1] - 2026-09-21

### Fixed

- **The Updater tells a program from a plugin.** `opencode-worktree@latest` in a plugin list names a
  command-line tool on npm, with no plugin entry points; OpenCode refuses it, and the Updater used to
  propose pinning it and then fail with that same refusal. It now reads the installed manifest and
  applies OpenCode's own rule — `exports["./tui"]`, `exports["./server"]`, `main` or `oc-themes` —
  and lists anything else as `not a plugin`, with the file to remove the entry from. What OpenCode
  already loaded is never questioned, and a manifest it cannot read proves nothing.
- **A pin says what it is for.** The review showed `0.4.1 → 0.4.1`, which read as a bug; it now reads
  `0.4.1 · pin, so latest cannot freeze again`.
- **A watch sees what the run printed before it was attached.** A shell that failed in its first
  milliseconds could print its failure before `shell.watch` arrived, and the run was judged without
  it. A new watcher is now caught up on the current run's recent output — never an earlier run's —
  and on its exit, if it has already ended.

## [0.5.0] - 2026-09-21

### Added

- **Updater: every plugin you have installed, what it is really running, and an update checked
  against disk.** OpenCode installs a plugin into a cache directory named after its spec and never
  resolves it again, so `some-plugin@latest` — or a bare name — means the release that was newest
  *the day you first installed it*: one person sat on 0.1.2 while 0.4.2 was published. `/plugins-update`
  lists every plugin with what is running beside what the config says and what is published;
  `latest ⚠` marks a spec that will not move on its own. The review shows every file and cache
  directory that will change before anything is written. An update pins an exact version through
  OpenCode's own `opencode plugin -f`, removes the stale cache, and reads every file back — the
  command prints "Installed" over entries it left alone, so disk is the only evidence. Whatever is
  still wrong comes with the exact command that fixes it. [Docs](https://codestz.github.io/opencode-cockpit/updater/overview/)
- **The rescue, for anyone too far behind to have it:** `npx opencode-cockpit@latest update` (or
  `bunx`). It runs from npm rather than from the copy that is stuck, and both re-resolve `@latest` on
  every run — what OpenCode's cache does not do. `--dry-run`, `--only <name>` and `--yes`.
- **A failed install says why, and what fixes it.** npm's cache holding files you do not own — an old
  `sudo npm` — fails every install that touches them; the result names it and puts
  `sudo chown -R "$(whoami)" ~/.npm` before the retry.

### Changed

- **Every install line pins a version**: `opencode plugin opencode-cockpit@0.5.0 --global --force`.
  The documented bare install was the command that created the frozen state; `--force` makes the same
  line the way to move to a newer release.
- **`/cockpit-update` opens the Updater**, for every plugin rather than only this one. The daily notice
  moved with it and counts every plugin; `ui.updateCheck: false` still silences it.
- **The registry is the one npm uses** (`npm_config_registry`), so a plugin on a private registry is
  asked where it lives.

### Fixed

- **The update check never got an answer.** It asked npm for abbreviated metadata on `/latest`, which
  npm now refuses with a 406, so no update was ever announced and `/cockpit-update` offered a
  reinstall with no version. The test stubbed the request and asserted the header, so it stayed green.

## [0.4.3] - 2026-09-21

### Fixed

- **The documented keys match the keys.** Review's table still offered a third source that 0.4.2
  removed, the statusline's `git.diff` was still described as counting the session, and the shell's
  console table was missing `d`, `shift+d`, `backspace`, `ctrl+]` and everything that scrolls — along
  with the two keys that open the panel and the console in the first place. Every bay now documents
  what it actually binds, including the statusline, which binds nothing and says so.

### Changed

- **The console names its keys the way Review does, and stops carrying all of them.**
  `i type · c ^C · r restart · tab screen · / search log` was a sentence you had to parse before you
  could use it, and at nine keys there was no room left for the words. The row now holds only what
  acts on the shell in front of you — `[i] Type  [c] ^C  [r] Restart  [x] Stop` — and `[?] Details`,
  which opens the panel where the rest are laid out in two columns, under the shell's own facts. The
  bracket does the work colour would otherwise have to do, and colour stays with the shells.

## [0.4.2] - 2026-09-21

### Changed

- **Review reads two sources, not three, and the statusline counts git.** "This conversation" is
  gone. It was built on OpenCode's `session.diff`, which returns an empty list for a session whose
  own snapshots plainly differ — checked against three baselines, with the snapshot trees diffed by
  hand to confirm the changes were really there. A mode that cannot answer is worse than one that is
  missing, so it has been removed along with the dead `FileChange.marked` it was reserved for.
  `[b]` now toggles uncommitted and branch.

  The statusline's `session.diff` segment rested on the same feed and made the same promise. It is
  now `git.diff` and reads `git diff --shortstat HEAD` — what is uncommitted, a number you can check
  by running the command yourself. The old name still resolves, the command runs only when a line
  actually carries the segment, and a line without it spawns nothing.

### Fixed

- **`/cockpit-update` no longer promises an update it cannot make.** It cleared the cached copy and
  told you to restart — but if your config pins `opencode-cockpit@0.4.1`, the next start reinstalls
  0.4.1 and the version never moves. It now reads both plugin lists (`opencode.json` and
  `tui.json`), and when a pin is in the way it says which entry to edit instead of clearing a cache
  for nothing. A path install and a tag are not pins, so neither is treated as one.

- **The handover tells the agent what it needs before it asks.** The submit message now names the
  files the comments are in, so the first move is not a tool call spent finding out where the work
  is; says plainly that resolving is *refused* while a file still reads as it did, which is what
  `review_reply` actually does; and draws a boundary — these comments, no unrelated work, no
  commits, and say so in the reply when a comment turns out to be the tip of something bigger.

- **The panel no longer fails in silence.** The change store set a `notice` in four places — "no
  conversation open", every git error, "file too large" — and nothing ever read it, so each of those
  reached the screen as an empty pane with no explanation. It is now shown in the footer, and the
  empty state names the source it is empty for and points at the key that changes it.

- **`[s]` says how much there is to submit**, and says the right thing when there is nothing. The key
  carries a live count and dims at zero, and the three ways to have nothing to hand over — no
  comments yet, all answered, all outdated — now read differently instead of all claiming every
  comment had been answered. Submit also counts outdated comments before offering, so the number it
  offers is the number it sends.

## [0.4.1] - 2026-09-21

### Fixed

- **`YOU` and `AGENT` are readable on every theme.** The badges on a comment — and the `review`
  badge in the header — printed their word in the theme's background colour, which paints nothing
  at all when a theme leaves that colour transparent: the coloured block appeared, the word inside
  it did not. The ink is now chosen rather than assumed, taking the first theme colour that both
  paints and stands clear of the block it sits on; where a theme offers nothing that reads, the
  block is dropped and the badge is printed in its own colour instead.

- **A shell the agent starts from a subagent now belongs to the conversation you are in.** A tool
  called inside a task runs in a *child* session, and the shell was stamped with that id — so the
  panel, which filters by the session on screen, showed the agent's own shells only under "whole
  project", and `/shell` listed shells that looked like they came from somewhere else. Ownership now
  resolves up `parentID` to the conversation that asked, and the guidance the agent reads resolves
  the same way, so "this session" means the same thing on both sides.

### Added

- **`sidebarOrder` puts the bays in the order you want.** Shell and Statusline both draw in the
  sidebar, in the order they register — which was a constant nobody could reach. Set
  `ui.sidebarOrder` for Shell (default 150) or `statusline.sidebarOrder` (default 200); lower draws
  first.

## [0.4.0] - 2026-09-21

### Fixed

- **A file containing `@` before a bracket or a space no longer freezes the interface.** The Review
  syntax scanner accepted `@` as the start of a word but not as part of one, so it advanced by zero
  characters and looped forever — at 100% CPU, with no error, no stack and no way out but killing
  OpenCode. Ctrl+C did not help either: a synchronous loop never reaches a signal handler. Every
  branch of the scanner must now advance, and the test is every printable character in ten
  languages plus all 9,025 two-character pairs.
- **A daemon whose socket has been deleted now stops instead of stranding its shells.** A unix socket
  is held by its inode rather than by its name, so removing `~/.cache/opencode-cockpit` — where
  cleanup tools aim — left the daemon running and listening on a path that no longer existed. The
  next client found no socket, started a second daemon, and the first kept its shells alive where
  nothing could see or stop them: a dev server holding a port, findable only with `ps`. There is no
  way back from that state, since a client can only reach the daemon through the path, so it shuts
  down and lets its shells go rather than leaving them stranded for the rest of the session.

### Added

- **Review — a pull request in the terminal.** Bay 02, `@opencode-cockpit/review`. The diff where
  the work happened, comments on the lines they are about, and an agent that can read them, answer
  them and mark them resolved. Comments live on the branch rather than in the chat, so they outlive
  the conversation; `s` hands the review over, and the notes travel as structured data through
  `review_list` rather than as prose the agent has to parse back out of a message. A resolve is
  checked against the file before it counts: an agent that claims "done" over an untouched file has
  its reply kept, the thread left open, and is told so plainly. It can open notes of its own with
  `review_open`, which appear in the panel beside yours. `<leader>v` opens it.
- **`bun run clean:daemons`** stops cockpit daemons that nothing can reach any more — orphans whose
  home is gone, and daemons left behind by an interrupted test run. `test` and `check` run it first,
  because a leftover daemon does not fail a suite, it hangs one.
- **The line reports its own failures, on the line.** A module that would not load draws a `⚠` row
  naming it, and a column that ran out of room draws a dim `↳ N more — raise maxRows`. Both used to
  end as segments that were simply not there, which is indistinguishable from a segment that had
  nothing to say — the one place this bay's silence rule is wrong. The overflow notice takes a row
  of its own, and is the first thing dropped if the column is smaller still.

### Changed

- **`preview --module <path>` draws that module and nothing else**, every segment it declares, with
  room for all of them. It used to be added to whatever the config already named while the config's
  *segments* still decided what drew — so pointing the preview at a module whose segments the config
  does not list produced a confident picture of somebody else's line. `--with-config` restores the
  old behaviour, which is what you want once the module is finished and you want to see it in place.

## [0.3.2] - 2026-09-20

### Added

- **`/statusline`** hands the agent in your session a brief instead of drawing a panel: which config
  file this project reads, what is drawing now, your modules and any that failed to load, the preset
  and segment names, and where the design skill lives. It ends by asking what you want it to show.
  Customising a line is an editing job, and the agent is already sitting there.

### Fixed

- **`bunx @opencode-cockpit/status preview` works.** It was exiting 1 and printing nothing, for two
  reasons at once: the published entry had no shebang, so a shell read the JavaScript as a shell
  script, and `bunx <package>` looks for a bin named after the package's last segment, which was
  never declared. Both are invisible from a checkout, where nobody runs the bin — so the command
  every page here recommends had never once worked from npm.
- **A statusline module outside a project loads again.** The fallback that makes
  `~/.config/opencode-cockpit/modules/` work asked for `./authoring.ts`, which a built copy does not
  have beside it, so it threw — and with it went every module belonging to the people that fallback
  exists for. It worked only from a checkout, which is where the tests run.
- **A missing `ps` no longer fails every shell.** The daemon recorded a process' start time by
  spawning `ps` from PATH, on the path that starts a shell, so a daemon that inherited an editor's
  slimmer PATH turned every `shell_start` into
  `ENOENT: no such file or directory, posix_spawn 'ps'`. It is a best-effort guard against pid reuse
  and now behaves like one.

### Documentation

- **The design skill contradicted itself about the empty half of a bar**, calling for `panel` in its
  rules and warning two paragraphs later that `panel` is the colour of the panel the bar sits on, and
  therefore invisible. The track is `border` — the same wrong tone was in the drawing page's examples.
- **The six sample states are written down**, with what each one catches: the wall of zeroes on
  `fresh`, the column widths only `full` reveals, the invented `$0.00` on `unpriced`, the rows that
  vanish mid-turn on `retrying`.
- **Two glyph rules the last design pass earned**: no end caps on a bar in a column, because `▕` and
  `▏` are eighth-blocks whose ink sits against one cell edge and indent the row out of alignment;
  and print a number once, because a bar and the labelled row below it were both reporting `43%`.

## [0.3.1] - 2026-09-20

### Added

- **`preview` — draw your statusline in a terminal, without restarting OpenCode.**
  `bunx @opencode-cockpit/status preview --watch` redraws on every save, against six sample
  sessions: a fresh one before the first reply, a long one nearly out of room, one behind a proxy
  with nothing declared, a stalled one, and no session at all. Designing a statusline used to mean
  editing, restarting and squinting — one sidebar cost about twenty restarts, and three of the
  mistakes were glyph choices that read differently on screen than in a sentence.
- **`"debug": true`** draws a placeholder where a segment said nothing, so the three reasons a
  segment can be absent stop looking identical: `⟨context⟩` it ran and had nothing to say,
  `⟨?contex⟩` nothing answers to that name, `⟨!name⟩` it threw.
- **A segment can return several rows.** An array is a row each, which is how a gauge, a table or a
  row per service is drawn. Returning one used to be a silent no-op.
- **`italic` and `underline` on a run**, drawn as markup. `strikethrough` and `inverse` are not
  offered: OpenTUI has no element for either, so they could never have reached the screen.
- **`examples/gallery.ts`** — every technique the renderer offers in one column: six kinds of bar,
  braille, sparklines, rules, dots, chips, dividers, emphasis, every tone, and multi-row output.
  Run it through `preview` and copy the row you want.
- **A design skill**, shipped with the package at `skills/statusline-design/`, carrying the rules
  this bay learned the expensive way — solid bars rather than dashes, words rather than colour
  alone, no headings above optional rows, look at it before shipping it.

- **Presets** — a whole line by name, built-ins only: `minimal`, `default`, `detailed`, `sidebar`.
  Anything written beside one wins, so it is a starting point rather than a mode.
- **`examples/sidebar-budget.ts`** — a sidebar drawn as a table, and the layout a user arrived at
  after five rejected iterations: a fixed six-column label gutter so every value lines up, one bar
  with no figure beside it, the tokens split into named rows, a budget read from whatever a proxy
  writes to `~/.cache/opencode-litellm-iap/spend.json`, and the branch's whole diff against its
  merge-base rather than what this session happened to touch. `"demo": true` fills in sample
  figures for the budget rows, so the column can be looked at before a proxy exists.

### Fixed

- **A statusline module that fails to load now says so in OpenCode's log**, not only in a toast
  that is gone in ten seconds. The entry names both the module and the directory resolution was
  attempted from, which is the pair that makes an import failure obvious instead of mysterious.
- **`maxRows` and the padding settings work at the top level of the config**, not only inside a
  `lines` entry. Writing them there is the natural guess, and being quietly ignored cost exactly
  the rows they were meant to keep.

### Documentation

- **The design skill is documented on the site**, at *What you can draw* — where it ships, how to
  point an agent at it, and what it actually carries. It existed in the package and was mentioned
  only in this file, which is no way to find anything.
- **Two glyph traps written down**: `▕` and `▏` are eighth-blocks whose ink sits against one edge
  of the cell, so end caps indent a column's bar out of alignment with its labels; and an empty
  track wants a solid `█` in the `border` tone, because `░` reads as floating gaps and `panel` is
  the colour of the panel it sits on.
- **The worked-examples lists name all five modules.** They still said two.

## [0.3.0] - 2026-09-19

### Added

- **Statusline, bay 02.** A line of live session state under the conversation, or a column of it in
  the sidebar. Fourteen built-in segments, two surfaces, and three ways to configure it: declarative
  segments in `.cockpit.json`, your own TypeScript module, or a shell command.
  `opencode plugin @opencode-cockpit/status --global`, or get it with the bundle.
- **Your Claude Code statusline works here.** A command segment is fed the same JSON on stdin that
  Claude Code's `statusLine` hook sends, including `context_window` and `current_usage`, so an
  existing script runs unchanged. Its colours survive too: the SGR escapes are parsed rather than
  stripped, with 24-bit and 256-colour values kept exactly and the basic sixteen mapped to theme
  tones. Multi-row scripts keep their rows.
- **Segments written in TypeScript**, against `@opencode-cockpit/status/segment`. A module is handed
  the same snapshot the built-ins get and touches no OpenCode api, so a custom segment is as
  testable as a built-in — and because it is loaded once and called on every repaint, it can keep
  history, which is what makes a sparkline or a rate possible. A module can live in your config
  directory rather than inside a project; nothing needs installing beside it.
- **Honest behind a proxy.** Tokens always work. Cost and the context percentage are computed from
  your model catalogue, so behind LiteLLM or a gateway they need declaring in `provider.<id>.models`
  — and where they are not declared, those segments stay silent rather than reporting `$0.00` and
  `0%`. The same rule runs through the bay: a segment with nothing to say says nothing.

### Changed

- **Shell's status marks are a coloured rule rather than a filled pill.** A block of colour has to
  be as wide as the word inside it, and a column of them reads as a wall of colour competing with
  the shell names beside it. Same seven columns, so lists still line up.
- Room under the **Shells** heading in the sidebar, so the title reads as a heading and not as the
  first item of the list.

## [0.2.2] - 2026-09-18

### Changed

- **The panel shows the conversation you are in.** A project's shells listed together stopped making
  sense as soon as two sessions were open. Switching conversations now changes what the panel lists,
  without stopping anything; `s` in the console widens it to the whole project and back, and
  `shell_list` already took `session`.
- **Shells end with the window that started them.** `lifecycle.onExit` defaults to `stopMine`, so
  closing OpenCode stops its own shells — a window closing counts only once both halves of the
  plugin have gone, so quitting one of two open windows never touches the other's. `keep` restores
  the old behaviour of leaving them for the next window.

### Added

- `lifecycle.orphanAfterMinutes` (60 by default): a shell no window has been connected to for that
  long is stopped, so nothing runs for a week because everyone who knew about it has gone.
- `/shells-stop` stops the shells in view; `/shells-stop-all` stops every shell in the project and
  confirms first when that reaches conversations you are not looking at. "Everything I can see" and
  "everything, including what I cannot" are different intentions.

### Fixed

- A shell started by hand had no session recorded, so the session-scoped panel did not list it — and
  attaching then asked the daemon for output from an offset past the end, which crashed the handler
  and left the console empty. Manual shells now belong to the conversation they were started from,
  attaching looks in every shell rather than only the listed ones, and an offset past the end is
  read as "only what comes next" instead of an error.

## [0.2.1] - 2026-09-18

### Added

- `watch` on `shell_start` takes a rule object (`{ done, fail, ok, idleSeconds }`), not only a preset
  name. It read as documented before and was not. A rule that arrives as JSON *text* is parsed as a
  rule too — including the under-escaped JSON a model writes when the patterns are regexes
  (`{"done": "\d+ passed"}`) — instead of being passed on as a preset name nobody has.
- Watching a command no preset matches no longer fails: the shell is watched for dying (preset
  `exit`), so `sleep 300`, a deploy script or any quiet process gets crash detection without
  patterns.

### Changed

- An ended shell says why it ended and who ended it, instead of "killed by SIGTERM": "stopped: hit
  its time limit", "stopped: no output for its idle limit", "stopped by you, from the shells panel",
  "stopped by the agent", "crashed with exit code 3". `ShellInfo` carries `stopReason` and
  `stoppedBy` (protocol 1.3), and the panel shows the short form.
- Clearer watch errors: an unknown preset now says `no watch preset named "x"` and points at both
  `shell.presets` and custom rules.

## [0.2.0] - 2026-09-18

### Added

- **Configuration.** One file, read by both halves of the plugin:
  `~/.config/opencode-cockpit/config.json`, then `<project>/.cockpit.json`, then plugin-entry
  options, merged key by key. Define your own shell `kinds` (regex → name, also filterable in
  `shell_list`), your own `watch.presets`, `defaults` applied to every shell the agent starts
  (`watch`, `logFile`, `timeoutSeconds`, `idleTimeoutSeconds`, `notifyOnExit`), what may interrupt
  the agent (`notify`), how much context the plugin spends (`guidance`, `listRunningShells`), and
  the interface (`ui`). `watch.auto` attaches a matching preset to every new shell; it is off by
  default. An invalid config file is ignored rather than fatal.
- **Watchers.** `shell_watch`, or `watch` on `shell_start`, follows a never-ending process and
  messages the agent only when its health changes ("tsc: ok → fail" with the offending line), never
  while a run repeats the same result. A watched process that dies is reported as a failure, so a
  crashed dev server no longer goes unnoticed. The panel, sidebar and console show the health
  (`tsc ✓`, `vitest ✗`), and `shell_list` includes it.
- A watch rule is three regexes — `done`, `fail`, `ok` (plus `idleSeconds`) — not a parser. About 35
  presets ship for common tools (tsc, eslint, biome, prettier, mypy, ruff, vitest, jest, mocha, bun
  test, deno test, pytest, rspec, phpunit, playwright, cypress, vite, next, nuxt, astro, angular,
  webpack, esbuild, tsup, turbo, metro, storybook, cargo, go, dotnet, gradle, maven, docker compose,
  terraform), picked automatically from the command; anything else takes its own patterns.
- An update notice: the plugin checks the registry at most once a day and offers `/cockpit-update`,
  which clears its cache entry so the next start installs the new version. OpenCode resolves an
  unpinned plugin spec only once, so installs never moved forward on their own.
- `bun run release <patch|minor|major|x.y.z> [--push]` bumps every package, promotes the changelog
  and tags, so releases stop being a manual edit.
- **Log search in the console.** `/` filters a shell's scrollback to matching lines, keeping line
  numbers and highlighting matches; `backspace` clears the filter. Filtering runs in the daemon.
- **Colours.** The panel and console paint the colours programs actually print, instead of stripping
  them.
- **Limits.** `idleTimeoutSeconds` stops a shell after that much silence (never a default: healthy
  dev servers are idle), alongside the existing `timeoutSeconds` wall-clock limit. Both explain
  themselves in the shell's summary.
- **Log files.** `logFile` writes a shell's clean log to `~/.cache/opencode-cockpit/logs/<id>.log`,
  so history survives the in-memory buffer.
- **Shell kinds.** Shells classify themselves from their command (server, tests, build, watcher,
  task); `shell_list` filters by `kind`, so "which servers are up?" is one call.

### Changed

- Package internals are grouped by role: `core/` (pure logic shared by both halves), `agent/` (the
  server plugin and one file per tool), `tui/` (`components/`, `state/`, `lib/`), and the wire
  schemas split by concern. No behaviour change, but features now land in one obvious place.
- Console keys now show only what applies: no sidebar-only "show all", no "clear finished" without
  finished shells, and `[` `]` cycles every shell rather than just the unfolded ones.

## [0.1.5] - 2026-09-18

### Fixed

- The TUI half rendered one frozen frame when installed from npm: the panel, console and sidebar
  appeared but never updated, while keybinds, RPC calls and shells all worked. OpenCode compiles
  plugin JSX with OpenTUI's Solid transform, whose Bun plugin skips every file under
  `node_modules` — where an installed plugin always lives — so published `.tsx` produced
  components with no reactive tracking. Every package now publishes JavaScript compiled with that
  same transform. A local checkout was never affected, which is why 0.1.3 and 0.1.4, which guessed
  at dependency layout, did not fix it.
- Clicking a shell in the sidebar or panel needed the mouse button held down: the console opened on
  press, and the release landed on the dialog backdrop, which closes it. They open on release now.

### Changed

- `solid-js` and `@opentui/*` are no longer shipped with the plugin. The compiled code imports them
  by name and OpenCode rewrites those imports to its own instances, which is what keeps reactivity
  and the keymap shared with the host.
- The sidebar shows at most 5 shells (`sidebarRows`), then `▸ N more`; expanding caps at 12 and
  points to the console. The panel keeps its tabs to what fits the window. A hundred shells can no
  longer push the sidebar off screen.
- Every package builds through one script (`bun run build`) and publishes `dist/`.

### Added

- `bun run smoke:tui` drives a real OpenCode against the packed plugin and fails if the panel stops
  updating; `bun run pack:check` fails if a published TUI entry is not Solid-compiled or if
  `solid-js`/`@opentui/*` are installed with the plugin.

## [0.1.4] - 2026-09-17

### Fixed

- `@opencode-cockpit/shell` pinned `solid-js` to `1.9.15`, one patch version above the `1.9.12`
  that `@opentui/solid` and `@opentui/keymap` require as a peer. A published install (plain `npm
  install`, as the opencode plugin installer runs) can't satisfy both from one copy, so it nested a
  second private `solid-js` under `@opencode-cockpit/shell`. Solid's reactivity is instance-local:
  the docked panel and console read signals from the nested copy while `@opentui/solid`'s render
  bridge tracked the hoisted one, so the panel painted once on open and then never updated again —
  keybinds and shell output all reached the daemon fine, nothing ever reappeared on screen. Pinning
  `solid-js` to the exact version the peer requires (`1.9.12`) collapses both back to one instance.
  Bun workspaces (`bun install` from source, `bun run pack:check`) tolerate the mismatch by
  deduping anyway, which is why this didn't reproduce there — only a real `npm install` split it.

## [0.1.3] - 2026-09-17

### Added

- Shell tools accept a shell's name instead of its id, e.g. `shell_read name="DB Monitoring"`;
  ambiguous names return the candidates.
- `shell_list` filters by text, status and session, and shows which session (by title) or the user
  started each shell. The agent's system prompt marks shells from other sessions.

### Changed

- `opencode-cockpit` no longer lists `@opencode-cockpit/client` as a runtime dependency (it comes
  through the features that use it).

### Fixed

- `@opencode-cockpit/shell` declared `@opentui/core`, `@opentui/keymap`, `@opentui/solid`, and
  `solid-js` as peer dependencies, which the opencode plugin installer does not install. A fresh
  install of the published package silently dropped the TUI half (no docked panel, no keybinds),
  while the server half kept working. They are now real dependencies.

## [0.1.2] - 2026-09-17

### Added

- Features ship as separate plugins: install everything with `opencode-cockpit`, or only
  `@opencode-cockpit/shell`. `opencode-cockpit` accepts `features` to switch features off and
  per-feature options under the feature's name (top-level Shell options from 0.1.x still work).
- A feature configured twice (bundle and standalone) loads once, with a warning naming the entry to
  remove.

### Changed

- An outdated daemon is only replaced by clients running newer code, so plugins at different
  versions sharing one daemon no longer replace each other.

## [0.1.1] - 2026-09-17

### Fixed

- Packages published as 0.1.0 depended on internal package version 0.0.1, which does not exist,
  so `opencode-cockpit@0.1.0` could not be installed. Use 0.1.1.
- Releases now fail before publishing if a packed package pins an internal dependency to a
  version other than the one being released.
- `shell_wait` / `shell.wait` with a pattern now matches a prompt that was already on screen
  (no trailing newline) before the wait started, instead of timing out.

## [0.1.0] - 2026-09-17 [YANKED]

### Added

- **Shell**: background PTY shells hosted by `cockpitd`, shared across OpenCode windows and
  surviving restarts.
- Agent tools `shell_start`, `shell_wait`, `shell_read`, `shell_send`, `shell_list`,
  `shell_stop`, `shell_restart`, with permission prompts through OpenCode's `bash` rules.
- Wait conditions: output pattern (including unfinished prompt lines), open port, idle output,
  exit.
- Clean agent logs: escape sequences removed, redraws collapsed, repeated lines folded,
  cursor-based reads and grep.
- Exit notifications to the session that started a shell.
- Reuse of finished shells for repeated commands within a session.
- TUI: docked shells panel, sidebar section, keyboard-first console with typing mode, log and
  details views, status badges, folding of finished shells, clear finished.
- Daemon lifecycle: on-demand start, single instance under concurrent starts, idle shutdown,
  replacement of outdated idle daemons, orphan reaping after crashes.

[Unreleased]: https://github.com/Codestz/opencode-cockpit/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Codestz/opencode-cockpit/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Codestz/opencode-cockpit/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/Codestz/opencode-cockpit/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Codestz/opencode-cockpit/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Codestz/opencode-cockpit/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Codestz/opencode-cockpit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Codestz/opencode-cockpit/releases/tag/v0.1.0
