# config/etiquette.md — how to behave on someone's machine

You were invited in to do one job. Anything bigger or more intrusive than that job is a **new ask**.
These rules keep the agent from surprising the person whose machine it is.

## 1. Don't fight a person for the keyboard

Before you start acting — and if you notice input you didn't send (the pointer moving, text appearing,
a window changing) — assume a real person is using the machine. Presence is observable (ScreenMirror
tracks `user-present` / `user-away`; see [reference/screenmirror-features.md](../docs/reference/screenmirror-features.md)).

When someone is active, **ask before taking over**, through session chat:

> "I'm about to work on this machine for a few minutes. Could you pause for a bit — or shall I take
> exclusive control while I do it?"

Then act on the answer:
- *"go ahead / I'll pause"* → work, but keep steps small and watch for them coming back.
- *"take control"* → `lock {on:true}` (exclusive control — this disarms the other operators), do the
  work, then `lock {on:false}` **the moment you're done**. It also dies by itself when your grant ends.
- *no answer* → don't barge in. Do read-only steps (look, report) and wait.

Never hold exclusive control longer than the work needs, and never take it silently.

## 2. Gate the irreversible

Before anything hard to undo, **announce it in session chat to everyone and wait for a human yes**:

- restart / shut down / log off / sleep / lock
- delete, overwrite, or move files; empty trash
- stop/disable a service; kill a process a person is using
- sign out, change a password, uninstall

Pattern:

> "About to **restart** 10004 to finish the update. Reply **stop** in the next ~20s if not — otherwise
> I'll proceed."

Rules for the wait:
- **A cancel wins, always.** If anyone says *"no / stop / wait / I said wrong"* — even right after
  saying yes, even mid-countdown — abort immediately and acknowledge.
- People type fast and may send several messages or correct themselves. Read the **latest** intent,
  not the first. If it's ambiguous, don't do the dangerous thing — ask again.
- Only proceed on a clear, current yes (or an explicit "no need to ask me for these").
- The destructive-command gate still applies even with a yes — read what you're about to run.

Use the **`confirm {text, timeout}`** verb for this: it announces to everyone, waits the window, and
returns `{verdict, replies}` — `cancelled` the moment anyone says no/stop/wait (even after a yes),
`approved` only on a clear yes, else `unclear`. **For a real restart/shutdown/logoff, proceed only on
`approved`; treat `unclear` (silence) as no.** For asking someone to pause (§1), the plain
`chat` + `chat-wait` verbs are enough. (All of this rides on session chat — needs the relay deployed.)

**A standing yes, for a machine the operator left you on.** When they have pre-approved these — the run
carries **`--auto-confirm`**, or **`SM_AUTO_CONFIRM=1`** is set in the kit's `.env` — `confirm` still
announces the action and still waits the window, and a **stop still wins at any point**; only a *silent*
window now comes back `approved` (with `auto:true`) instead of `unclear`, so the agent proceeds rather
than stalls with no one there to type "yes". This is the "no need to ask me for these" of the rule above,
made mechanical. Leave it off whenever someone is at the machine to answer — and a `cancelled` is still
a cancel, auto or not.

## 3. Leave no mess

Close what you opened if it isn't the deliverable, hand the grant back when done, and say plainly what
you changed.

## 4. Write in chat like a report

What you post in session chat is read at a glance, in a narrow panel, by people in the middle of their
own work. The viewer (2.162.0+) lays an agent's message out as Markdown blocks in a bubble of its own —
an older viewer shows the same text as plain lines — so write Markdown that also reads well bare:

- **Open with ONE status line**: a glyph for what happened, the result in bold, a short tail —
  `✓` done · `⚠` needs you, or stopped · `✗` failed · `ℹ` a note. The line is banded in its colour.
- **Then the facts as `- ` bullets**, one to five: a step, a number in **bold**, a command in `code`.
- **The question last, on its own line** — and when there are choices, number them, so the answer can be
  one digit: `1.` take exclusive control, `2.` work around you.
- `##` headings, `>` quotes, `---` and `| tables |` are there for a longer report; most messages stay
  under eight lines. No walls of text, and no run-on sentence of times in brackets.

```text
**✓ Sudoku solved in 18.4 s** — no mistakes
- **Read** the 81 cells from the screen · 3.9 s
- **Filled** in 56 numbers · 10.2 s

Anything else, or shall I sign off?
```

A tool that finishes a task hands over its report as `status {fin:1, say:'<markdown>'}`; the serve
posts it as the panel goes green (without `say`, it posts the panel's line as a ✓ status line). Add
**`file:'<crop.jpg>'`** and the picture of the result rides in the same message, above the question —
every task needs one ([AGENTS.md](../AGENTS.md), MUST NOT). Open each task with one line too:
`▶ **Starting:** <task>`.
