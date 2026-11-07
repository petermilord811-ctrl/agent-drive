# Changelog

All notable changes to agent-drive. The version follows [Semantic Versioning](https://semver.org/):
a **major** for a change that breaks a skill, a script or the serve protocol; a **minor** for something new;
a **patch** for a fix. Each pull request adds its line under **Unreleased**; a release moves them under its number.

## Unreleased

- CI tests Node 22 and 24 (Node 20 reached its end of life), with the current checkout and setup-node actions;
  the kit asks for Node ≥ 22.
- `node kit.js contribute` lists every changed file correctly (the first one lost a character in the pull request).
- While the agent types, everyone watching sees ScreenMirror's own "is auto-typing" card under its name ("SM Agent
  is auto-typing", with its progress), exactly as a colleague's Type window raises it, and it comes down when the
  typing ends. A person who presses a key stops the run, as they would stop a colleague's
  (`stoppedAt.tookKeyboard`). `autotype.run` takes an `onStep` callback.
- **Budgets** (`core/budget.js`): each task may take so many acting steps (a `plan` batch is one) and minutes —
  100 and 30 by default, `--budget-steps` / `--budget-min` to change them, 0 for none. When the budget is spent,
  acting commands are refused and the room is asked whether to go on; `budget {more:1, why}` hears their answer.
  Time spent waiting on people does not count, and a new task starts again.
- **Plan previews and checkpoints**: `mission plan … preview:1` asks the room before the job starts;
  `checkpoints:1` (or `checkpoint:true` on a milestone) asks after each milestone. A no, or no answer, holds the
  job — acting commands are refused until a yes; `mission ask` asks again and hears a yes already given.
- The serve's own questions (a budget, a preview, a checkpoint) use `confirm`'s rules for what a reply means.
- **Skills that write themselves**: a planned job that finishes proven — nothing failed, no skill already did it,
  not a replay — is saved as a draft skill in `skills/_drafts/<name>/` (gitignored), and the `finish` answer says
  so with the typed text it stores. `node drive/replay.js promote <name> --yes` puts a reviewed draft in the
  library; `--no-drafts` turns drafting off. A replay marks its plan `replay:1`.
- **Scheduled runs** (`drive/schedule.js`, [docs/reference/schedules.md](docs/reference/schedules.md)): a saved recipe
  or a command line runs at a time of day (on chosen days), every N minutes, hours, days or weeks, or once — by a
  runner you start (`node drive/schedule.js run`). Every visit still needs Allow unless the owner pre-authorised
  the agent; a run nobody lets in is recorded and never retried in a loop; missed fires are skipped, not caught up.
- **Jobs asked for in plain words** (`core/intake.js`): "connect 10004 and do my sticky notes" is read into the
  machine, the skill that does it, the access to ask for and the command line — `node kit.js intake "…"`, and the
  MCP server's new `intake` tool. An operator's chat message that names a job carries its skill in the inbox
  (`inbox.latest.skill`). kit.js reads its skills catalog through the same module.
- **Files, a webcam photo and a sound recording** (`fetch`, `send`, `camera`, `audio`; core/desk.js through `exec`, so
  the shell consent): files in chunks both ways, binary-safe, every one said in the room; `send` never writes over a
  file unless `overwrite:1`, which asks the room. A photo or up to 7 s of what the machine is playing (never a
  microphone) is asked of the room every time — only a clear yes allows it, never the standing yes or silence. The
  MCP `camera` tool returns the photo inline.
- **The change record and undo** (`core/undo.js`): what each command changed on the machine — files moved,
  renamed, copied, made or deleted, services, registry values, processes, files written, typed text (never the
  text), apps started, a file `send` put there, and what the driver declares with `changed` — with how it is put
  back. The finish of a task tells the room; `changes` lists it; `undo {id}` puts one back after a yes, or because
  they asked ("undo c3"); one that deletes what was made is never taken on silence.
- **The board** (`core/board.js`, [plan 07](docs/plans/07-the-board.md)): the panel is the room's control surface. Its buttons
  post chat lines with marks only the panel sends, honoured by the serve itself: pause / go on, stop the task, stop after
  a step, answers by question id (the inviter's yes only; anyone's no), Undo, the autonomy dial (each action / risky
  actions / checkpoints), skip / redo, save as a skill, schedule, "are you still there?". A person taking the mouse pauses
  the agent. New panel fields: goal and done-when, budget, where the time went, the question, changes, pause / stop, the
  dial, failures, row badges; frames of what the agent saw (`drive-eye`) and its proofs (`drive-proof`); clicks ring on
  the watchers' picture. Answers carry `room`, `paused`, `hold`, `autonomy`; refusals say `paused` / `held` / `approval`.
- `why:"…"` on any command (or batch step) is the panel's thought — the reason, shown above the plan, at no
  extra turn. A thought now ends with its step (a declared task, step or sub-step, a plan's move, a finish),
  and a new one replaces the last one's `conf` and `next` too.

## 1.0.0 — 2026-11-06

The first public release, as its own repository.

### The session
- Every command is checked against one verb table before it runs (`core/verbs.js`, `node kit.js verbs`); common
  slips are renamed and reported in `fixed`, anything else is refused; a plan is checked whole.
- `look` returns a picture sized for reading with its scale; clicks may be given in its pixels (`lx/ly`); any
  action may carry `look:{}`; a region is cut on the host where it can.
- Screenshots fetched in 128 KB slices, four at a time; the agent pauses its copy of the video stream.
- `confirm`: any negation, deferral or hesitation is a no; the standing yes fills only a silent window.
- A relay whose name stops resolving is dialled at its last address (TLS still checks the name).
- `access {shell|control|terminal}` asks for more on a new Allow card mid-visit; watch-only visits.
- `terminal` — the Terminal panel's shell, as its own consent.
- Typing is like a person by default (the ScreenMirror Type window's own planner); `human:0` is instant.
- `windows`, `focus`, `launch`, `controls` — windows and controls by name (never a value; passwords flagged).
- Text read locally when a host has no reader; `captcha` hands a CAPTCHA to the operator.
- Every picture a visit takes is deleted when it ends (`keep:1` / `--keep-captures`).

### Working at scale
- Missions: milestones achieved only with proof; `drive/replay.js` saves a proven job as a skill and replays it.
- An MCP server (`mcp/server.js`).
- `kit.js check / new / update / contribute` for contributors; CI on every pull request.
