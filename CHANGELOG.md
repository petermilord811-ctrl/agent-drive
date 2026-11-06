# Changelog

All notable changes to agent-drive. The version follows [Semantic Versioning](https://semver.org/):
a **major** for a change that breaks a skill, a script or the serve protocol; a **minor** for something new;
a **patch** for a fix. Each pull request adds its line under **Unreleased**; a release moves them under its number.

## Unreleased

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
