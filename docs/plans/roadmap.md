# docs/plans/roadmap.md

Turning the serve agent from "drives a desktop" into "a trustworthy operator that talks, shows its
work, and uses ScreenMirror's own features." Each plan is a standalone design; this is the order and
the reasoning.

## Build order

1. **[02 — session chat comms](02-session-chat-comms.md)** — *do this first.* It's the channel for
   asking questions, receiving advice, and confirming actions. Three later features depend on it.
2. **[01 — progress to viewers](01-progress-to-viewers.md)** — a calm, standout status of what the
   agent is preparing/doing, for everyone watching. High visibility, mostly standalone.
3. **[04 — concurrency & control](04-concurrency-and-control.md)** — sense presence, ask to pause or
   hold an exclusive lock. Needs chat (02) and presence.
4. **[05 — confirm dangerous actions](05-confirm-dangerous-actions.md)** — restart/shutdown/etc.
   announced in chat(All), honouring late cancels. Needs chat (02).
5. **[03 — use ScreenMirror features](03-use-screenmirror-features.md)** — spotlight/beam, sticky
   notes (write + read-and-work-through), as serve verbs. Incremental; ship per feature.

A good first slice was **02 + a watchdog reconnect** (below) — the two things the field runs most
needed. Both have since shipped.

## Missions — the big plan, milestones, proof (2026-10-27) ✅ BUILT

[06 — missions](06-missions.md): a job is planned as milestones that each say what will be on the screen when they
are done; a milestone counts as achieved only with proof; every change to the plan needs and says its reason; misses
are counted and hinted; the panel draws every milestone, the future ones too. Proven on a stand-in survey
(`tests/mission_survey.js`). Next: a live survey run. Mission recipes are in: `drive/replay.js` saves a proven job as a skill and replays it with no model turns (`tests/replay.js`).

## Next, from the first live `sudoku.js play` (2026-10-26)

1. **Follow-ups extend the tree** — [plan 01](01-progress-to-viewers.md), "Follow-ups after a finished
   task". The operator's next request becomes a step in the same panel and is finished; the panel no
   longer refreshes as a new task.
2. **Spotlight like a person; repeat until told to stop** — [plan 03](03-use-screenmirror-features.md).
   Visible rounds at a human pace (default 3); `forever:1` for every feature the agent shows, ending
   when the operator says stop.
3. **Parallel picture slices** — each look fetches 32 KB slices one round trip after another (~0.6 s each
   on the live relay), so a solve's two looks cost more than its 56 clicks. Pipeline `shot-get` in
   agent-join.js (`shot()` / `fetchTo()`); estimate: a solve from ~18 s to ~10 s.
4. **The new-game path, live** — `sudoku.js play` from the win screen is proven only on the stand-in.

## The shape of all of them
Every one is "add a verb (or an incoming-event hook) to the serve client, speaking a relay/viewer
protocol that already exists." Read the handler in `ws-server.js` / `viewer.html` first (pointers are
in [reference/screenmirror-features.md](../reference/screenmirror-features.md)); don't invent shapes.

## Other features worth building (the answer to "what else?")

- **Auto-reconnect watchdog.** ✅ SHIPPED. In `--serve` the client detects a dead/stale socket,
  redials the relay list (`SM_RELAY` then each `SM_RELAYS` fallback), re-prompts Allow, and resumes the
  command loop — surfacing `reconnecting.json` / `reconnect.json` to the driver while it waits, and
  ending (not reconnecting) on a revoke. See [config/connection.md](../../config/connection.md).
- **Files to/from the host in serve mode.** The viewer AI-Agent panel can screenshot, read & deliver
  files, snap the webcam, record speaker audio. Expose the same as serve verbs
  (`deliver-file`, `capture-camera`, `record-audio`) so the serve agent isn't limited to the screen.
- **Task macros / replay.** ✅ 2026-11-06: the serve records every successful command per milestone
  (`steps.jsonl`); `drive/replay.js save` makes a proven run a skill, `run` replays it, proving each milestone.
  Next: a live replay of a real job, and parameters other than secrets (a different file name, a date).
- **Preview / dry-run.** ✅ 2026-11-06: `mission plan … preview:1` posts the plan to the room as a question and the
  serve acts on nothing until they say yes; `mission ask` asks again (core/mission.js holds the gate).
- **Milestone checkpoints for long jobs.** ✅ 2026-11-06: `checkpoints:1` (or `checkpoint:true` on a milestone) stops
  after it and asks before going on; a no or no answer holds the job.
- **Natural-language intake over chat.** ✅ 2026-11-06: `core/intake.js` reads "connect 10004 and read my sticky-note
  tasks" into the machine, the skill, the access and the command line (`node kit.js intake`, the MCP `intake` tool), and
  an operator's message that names a job brings that skill with it in the inbox (`inbox.latest.skill`).
- **Change log / undo hints.** Record what was changed (files moved, settings flipped) so a human can
  reverse it, and offer the reversal.
- **Budgets.** ✅ 2026-11-06: core/budget.js -- 100 acting steps or 30 minutes a task by default; when spent, acting
  commands are refused and the room is asked (`budget {more:1}`).
- **Self-updating skills.** ✅ 2026-11-06: a planned job that finishes proven, that no skill did and that was not a
  replay, is drafted into `skills/_drafts/<name>/` (gitignored); `node drive/replay.js promote <name> --yes` adds a
  reviewed draft to the library -- a recipe stores typed text, so a person reads it first.
- **Scheduled / triggered runs.** ✅ 2026-11-06 (scheduled): `drive/schedule.js` runs a saved recipe or a command line
  at a time, every N, or once ([schedules](../reference/schedules.md)); each visit still needs Allow. Triggers: not yet.
  The original note: A task that fires on a schedule or an event (pairs with the relay's
  health/alert signals).
