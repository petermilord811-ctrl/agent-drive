# docs/reference/schedules.md — a saved job, run on a schedule

`drive/schedule.js` runs a job again when it is due — 09:00 on weekdays, every two hours, once next Tuesday — with
no AI driving it. That works only for a job whose every step is already known: a **recipe** saved from a visit whose
milestones were proven ([drive/replay.js](../../drive/replay.js) `save`), or a plain **command line**.

## What can be scheduled

- **A recipe:** `--recipe skills/<name>/replay.json` (or just `--recipe <name>`). Each run is a visit. The runner
  starts `core/agent-join.js --host <n> --task "…" --control --serve work/schedule/<id>/<time>`, the way the MCP
  server's `connect` does ([mcp.md](mcp.md)), and waits until the visit is serving. Then it runs
  `node drive/replay.js run`, and it ends the visit with a sign-off in the room that says how it went. If a recipe
  types a secret, name an environment variable for each one with `--secret-env NAME`. The runner reads it from its
  own environment when the job starts. The schedule never stores a secret.
- **A command line:** `--cmd "…"`. It runs as it is, in a shell, from the kit's folder. Its environment carries
  `SM_SCHEDULE_ID`, `SM_SCHEDULE_HOST` and `SM_SCHEDULE_DIR` (its own folder). Exit 0 counts as ok.
- **Not a free-form task.** With nobody driving, nothing decides the steps of "check the backups", so `add`
  refuses it. Do the job once as a mission (milestones, each proven), save it, then schedule the recipe.

## Every visit still needs Allow

A schedule does not change who lets an agent in. Each run asks the machine like any other visit. A person who can see
the machine presses **Allow** on the card, which shows the task line (`--task`) and a code that expires in about two
minutes. The only exception is a machine whose owner has pre-authorised this agent
([unattended-access.md](unattended-access.md)).

If nobody lets the run in within about three minutes, it is recorded as **not let in**, and the entry waits for its
next time. It is never retried in a loop. A person who refuses is recorded the same way, with their answer. `add`
says all of this when it adds a recipe.

## The commands

| command | what it does |
|---|---|
| `add --host <n> (--recipe … \| --cmd "…") <when> [--name] [--task] [--limit 4h] [--secret-env NAME]…` | adds an entry and says when it runs next |
| `list [--json]` | each entry: when it runs, its next fire, how its last run ended, the fires it missed or skipped; and whether a runner is running |
| `remove <id>` | removes an entry (a run in progress finishes) |
| `next [--n 5] [--json]` | the next fire times of every entry, merged |
| `run [--once] [--grace 2m]` | the runner, in the foreground. `--once` starts what is due now, waits for it, and exits |

Every command takes `--work <dir>`. The default is the kit's `work/`, which is never committed.

| when | |
|---|---|
| `--at 09:00` | every day at 09:00, on this machine's clock |
| `--at 09:00 --days mon-fri` | only on those days: names (`mon,wed,fri`), a range (`mon-fri`, `fri-mon`), `weekdays`, `weekends` |
| `--every 30m`, `--every 2h` | elapsed time, counted from when the entry was added |
| `--every 1d`, `--every 2w` | calendar days (or weeks) at the time of day the entry was added |
| `--once "2026-12-01 09:00"` | once; then the entry is done |

Daylight saving time never makes a daily job run twice or skip a day:

- A time the clocks jump over (02:30 in spring) fires when they have jumped (03:30).
- A time the clocks show twice (01:30 in autumn) fires the first time only.
- `--every 1d` stays at the same time of day across the change.

## What the runner keeps to

- **Never two runs of one entry.** A fire that comes while that entry's run is still going is skipped and counted.
- **One visit per machine.** An entry whose machine is busy with another entry's run waits for that run to end,
  then starts.
- **No bursts after downtime.** A fire that came while no runner was running (seen more than `--grace` late) is
  skipped and counted. It is not caught up when the runner comes back.
- **One failure stops nothing else.** Each job runs in its own processes, and its end is recorded on its own.

How a run ends, as `list` and `work/schedule.log` show it:

| result | |
|---|---|
| `ok` | the replay achieved every milestone (for a command: exit 0) |
| `not let in` | nobody pressed Allow in time, a person refused, or the relay would not ask |
| `failed` | a milestone's actions or proof failed, with the replay's own reason (for a command: its exit code and last line) |
| `timed out` | it ran past its `--limit` (default 4 h) and was stopped, with everything it had started |
| `interrupted` | the runner was stopped while it ran |
| `missed` | a `--once` whose time came while no runner was running |

The files:

- `work/schedule.json` holds the entries.
- `work/schedule.log` gets a line for each start, each end and each skip.
- `work/schedule/<id>/<time>/` is a run's own folder: the visit's serve files, `client.log` and `replay.log`, or
  `output.log` for a command.

## An example

```bash
# Once, with a driver: the job as a mission -- planned as milestones, each proven -- then saved as a recipe
node core/agent-join.js --host 10004 --task "export the weekly report" --control --serve ./work/report
node drive/mission.js ./work/report plan @plan.json     # ...work it through: step, achieve, finish
node drive/replay.js save ./work/report export-the-weekly-report

# From then on, every weekday at 08:30, with nobody driving
node drive/schedule.js add --host 10004 --recipe export-the-weekly-report --at 08:30 --days mon-fri
node drive/schedule.js list
node drive/schedule.js run      # stays in the foreground; Ctrl+C stops it
```

Jobs start only while a runner is running. To keep one going across restarts, start `node drive/schedule.js run`
from your own login items or service manager, or call `node drive/schedule.js run --once --grace 15m` every 15
minutes from the system's scheduler. The kit installs neither of these.
