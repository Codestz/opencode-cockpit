---
title: Panel and keys
description: Where the panel sits, every key that drives it, and what the footer is telling you.
---

## Where it sits

<kbd>&lt;leader&gt;v</kbd> opens and closes the review; <kbd>&lt;leader&gt;r</kbd> cycles where it
sits. `<leader>` is OpenCode's own prefix, `ctrl+x` unless you changed it.

| Placement | What it is for |
| --- | --- |
| **Right** | A pane down the right of the window, with the conversation still beside it |
| **Full** | The whole window, for when you are reading rather than chatting |

<kbd>w</kbd> switches between them from inside the panel. At half width the file list stays — it
narrows rather than disappearing, because a review you cannot change file in is a diff viewer.

## Keys

The panel takes the keyboard while it is open, and gives it straight back when it closes.

| Key | Does |
| --- | --- |
| <kbd>j</kbd> <kbd>k</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Move |
| <kbd>tab</kbd> | Switch pane |
| <kbd>return</kbd> <kbd>l</kbd> <kbd>→</kbd> | Open a file, or fold a folder |
| <kbd>h</kbd> <kbd>←</kbd> | Back to the file list |
| <kbd>d</kbd> <kbd>u</kbd> | Scroll the diff |
| <kbd>v</kbd> | Start a selection, or cancel it |
| <kbd>c</kbd> <kbd>n</kbd> | Comment here, or reply to the thread here |
| <kbd>f</kbd> | Comment on the whole file |
| <kbd>x</kbd> | Remove the thread you are on |
| <kbd>space</kbd> <kbd>m</kbd> | Mark read, and go to the next unread |
| <kbd>s</kbd> | Submit the review |
| <kbd>b</kbd> | Next source: uncommitted, branch, conversation |
| <kbd>g</kbd> | Reload the diff |
| <kbd>w</kbd> | Right pane or full screen |
| <kbd>p</kbd> | Show what the panel is costing |
| <kbd>q</kbd> <kbd>esc</kbd> | Close |

Submit is <kbd>s</kbd> and source is <kbd>b</kbd>, which looks arbitrary until you try it the other
way: they were <kbd>s</kbd> and <kbd>S</kbd> for an afternoon, two meanings on one letter separated
only by a shift, and one of them sends your review to the agent.

## The footer

Two rows, always, because the body's height is measured from them — a footer that grew would shove the
diff about every time something happened. So anything it has to say *replaces* the keys rather than
being added to them, in this order:

1. **Trouble.** Something threw. It is also written to `trouble.log` beside the review's threads, with
   the stack and what was on screen at the time.
2. **The numbers**, if you pressed <kbd>p</kbd> — how long a frame costs, how many were dropped, how
   often the row cache hit.
3. **The keys**, which is what you see the rest of the time.

The numbers are always being kept, whether or not you are looking at them. A debug mode you have to
remember to switch on is off during every problem worth seeing.

## A thread on screen

A comment is a band across the diff rather than a box: a tinted row spanning the full width *is* the
boundary, so it needs no characters to draw one. Inside it, a dim line says where the thread is and
how it stands, and an inverted badge says who is speaking — `YOU` or `AGENT`. The thread your cursor
is on gets one coloured column in its margin and shows what you can do to it.
