# docs/reference/schedules.md — a saved job, run on a schedule or when something happens

`drive/schedule.js` runs a job again when it is due — 09:00 on weekdays, every two hours, once next Tuesday — or
when something happens: the relay alerts that a machine is offline, a file lands in a folder, a script calls
([Triggers](#triggers-a-job-that-starts-when-something-happens)). No AI drives it. That works only for a job whose
every step is already known: a **recipe** saved from a visit whose milestones were proven
([drive/replay.js](../../drive/replay.js) `save`), or a plain **command line**.

## What can be scheduled

- **A recipe:** `--recipe skills/<name>/replay.json` (or just `--recipe <name>`). Each run is a visit. The runner
  starts `core/agent-join.js --host <n> --task "…" --control --serve work/schedule/<id>/<time>`, the way the MCP
  server's `connect` does ([mcp.md](mcp.md)), and waits until the visit is serving. Then it runs
  `node drive/replay.js run`, and it ends the visit with a sign-off in the room that says how it went. If a recipe
  types a secret, name an environment variable for each one with `--secret-env NAME`. The runner reads it from its
  own environment when the job starts. The schedule never stores a secret.
- **A command line:** `--cmd "…"`. It runs as it is, in a shell, from the kit's folder. Its environment carries
  `SM_SCHEDULE_ID`, `SM_SCHEDULE_HOST` and `SM_SCHEDULE_DIR` (its own folder), and for a triggered run the event's
  facts ([below](#what-a-triggered-job-is-handed)). Exit 0 counts as ok.
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
| `add --host <n> (--recipe … \| --cmd "…") <when> [--name] [--task] [--limit 4h] [--secret-env NAME]…` | adds an entry and says when it runs next, or what starts it |
| `list [--json]` | each entry: when it runs, its next fire (a trigger: what it waits for, when it last fired), how its last run ended, the fires it missed, skipped or counted; whether a runner is running and listening |
| `remove <id>` | removes an entry (a run in progress finishes) |
| `next [--n 5] [--json]` | the next fire times of every entry, merged |
| `hook [--new-token] [--listen [host:]port] [--json]` | the address to paste into the relay's webhook setting, and each direct call's |
| `run [--once] [--grace 2m] [--listen [host:]port]` | the runner, in the foreground. `--once` starts what is due now, waits for it, and exits |

Every command takes `--work <dir>`. The default is the kit's `work/`, which is never committed.

| when | |
|---|---|
| `--at 09:00` | every day at 09:00, on this machine's clock |
| `--at 09:00 --days mon-fri` | only on those days: names (`mon,wed,fri`), a range (`mon-fri`, `fri-mon`), `weekdays`, `weekends` |
| `--every 30m`, `--every 2h` | elapsed time, counted from when the entry was added |
| `--every 1d`, `--every 2w` | calendar days (or weeks) at the time of day the entry was added |
| `--once "2026-12-01 09:00"` | once; then the entry is done |
| `--on <event>` | when something happens: a relay alert, a new file, a call — see [Triggers](#triggers-a-job-that-starts-when-something-happens) |

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

- `work/schedule.json` holds the entries, and the token that the relay's webhook and direct calls carry.
- `work/schedule.log` gets a line for each start, each end and each skip, each message from the relay and each call.
- `work/schedule/<id>/<time>/` is a run's own folder: the visit's serve files, `client.log` and `replay.log`, or
  `output.log` for a command; and for a triggered run, `event.json`.
- `work/schedule/<id>/files.json` holds the files a folder entry has had, so none starts it twice.

## Triggers: a job that starts when something happens

`--on <event>` is the third kind of *when*, beside the clock's. The runner starts the job when the event comes.

| `--on` | starts the job when |
|---|---|
| `alert-<rule>`, e.g. `alert-offline`; `alert-*` for any rule | the relay opens a health alert of that rule |
| `recovered-<rule>`, `recovered-*` | the relay says that alert is back to normal: its condition ended |
| `resolved-<rule>`, `resolved-*` | a person marked that alert resolved; the condition may still hold |
| `digest`, `monthly-report`, `test` | the relay's daily digest, its monthly availability report, or the Test button beside its webhook setting |
| `file:<folder>` `[--match *.csv]` | a new file lands in that folder, once its size has held still |
| `http` | something calls `POST /run/<id>/<token>` on the runner's listener |

The rules are the relay's own. These are each about one machine: `offline`, `blind` (no picture), `degraded`,
`hostfault`, `disk`, `forecast` (a disk filling up), `battery`, `crash` (the host agent keeps exiting), `access`
(control taken out of hours or from a new address) and `checks`. `site` means several machines at one internet
address dropped together. `refused` (the relay refused a machine) and `relay` (a relay of the federation is down)
are about no machine.

- `--machine 10004` narrows an alert to that machine; `--machine 10001,10002` to any of those. The relay's name for one
  machine works too. A site alert matches each machine number it lists. It carries no names.
- `--host from-alert` visits the machine the alert names. An alert that names no single machine does not start such
  an entry. `add` refuses it with `refused` or `relay`, and with `site` unless `--machine` gives numbers.
- **Pin from-alert to machine numbers.** The relay's webhook is not signed, so whoever holds the token can send an
  alert that names any machine this agent may ask, including one whose owner pre-authorised it.
  `--machine 10001,10002` lists the only machines it may visit, and `add` warns when there is no such list. A name
  does not pin it: an alert can carry any name.
- `--debounce 1m` is the default (`0` for none): how long the same event again counts as one burst.

An offline machine cannot be visited, so `alert-offline --host from-alert` would only be "not let in". Use
`recovered-offline` to visit it once it is back, or give the job another machine, or a command.

### What the relay's webhook really sends

In the relay's console, **Health → settings → Send alerts to → a webhook (JSON POST)** posts each message as JSON.
This is what the relay's health operations (`web/ws-server.js`) send:

- **An alert** is `{event: 'alert-open' | 'alert-close', relay, at, machine, incident}`. The **rule is
  `incident.rule`**: `event` says only opened or closed. `machine` is the relay's **name** for the machine (`Fleet`
  when the alert is about no single machine). Its **number** is `incident.host`, and a site alert's machines are
  `incident.hosts`. The incident also carries its `id`, `title`, `text`, `sev`, `opened`, `closed` and `closeWhy`.
- **Once, when it opens.** A condition that goes on is not posted again, not even after the relay restarts. One that
  ends and comes back is a new incident.
- **Its end** is posted as `alert-close` only while **also say when it is back to normal** is on (it is by default).
  `incident.manual` is true when a person pressed Resolve: that is `resolved-<rule>`, not `recovered-<rule>`, and
  `incident.still` says what still holds.
- **Held, then summed up.** Quiet hours and a send-rate floor (30 messages a channel in 10 minutes) hold messages
  back, then post one `{event: 'alert-summary', held: [...]}`. The runner opens it up: each held message is an event
  of its own. The exception is an `alert-open` whose recovery is in the same summary: that condition is already over.
  One that a person marked resolved stays, because it may still hold.
- **Muted or left out.** A maintenance window mutes a machine's alerts. A private machine's alerts go out only when
  **include private machines in the outside channels** is on.
- **Unsigned, and sent once.** The POST has no signature and no auth header. A failed delivery is logged on the
  relay and not tried again.

### Connecting the relay

```bash
node drive/schedule.js add --host from-alert --machine 10001,10002 --recipe collect-the-logs --on recovered-offline
node drive/schedule.js hook      # prints http://127.0.0.1:8754/hook/<token>
node drive/schedule.js run       # stays in the foreground, and listens
```

Paste the address into the webhook setting and press **Test**. `work/schedule.log` then says `hook  test`, and
`list` says when the relay last reached the runner.

The runner listens on **127.0.0.1:8754**, this machine alone, whenever an entry waits for an alert or a call. That
is the safe default, and the relay reaches it only if the relay runs on this machine. A relay elsewhere needs the
runner on an address it can reach: `run --listen <an address of this machine>:8754`, or `0.0.0.0:8754` for all of
them. Binding wider is your explicit choice, and `run` warns when it does.

**The token is the only lock.** The relay's webhook has no signature, so every request carries the schedule's secret
token in its path: `/hook/<token>` for the relay, `/run/<id>/<token>` for a call.

- It is made on first use and kept in `work/schedule.json`, which only its owner may read. `hook` prints it;
  `hook --new-token` replaces it, and the old addresses stop working at once.
- A request without it gets the 404 of any unknown address. Nothing is kept of it but a count, which `list` shows.
- Plain http carries it in clear. Across a network you do not trust, put a TLS proxy or a tunnel in front.
- Anyone who can read the relay's Health settings sees it too.

### What a triggered job is handed

| | a recipe | a command line |
|---|---|---|
| the event (`alert-offline`, `file`, `http`, …) | `--set event=…` | `SM_EVENT` |
| the machine's number | `--set machine=10004` | `SM_MACHINE` |
| the file, with its full path | `--set file=…` | `SM_FILE` |
| the whole event, as JSON (the relay's name for the machine too) | the run's `event.json` | `SM_EVENT_FILE` |

A recipe gets the values on its `drive/replay.js run` line, each one argument and no shell, and ignores the names it
does not use. The runner checks before the visit that `drive/replay.js` takes `--set name=value`. If it does not, the
run is recorded "could not start" and nobody is asked to press Allow.

A command gets them in its environment, never spliced into its command line. Read them inside the program
(`process.env.SM_FILE`). Whoever drops a file chooses its name, and cmd.exe expands `%SM_FILE%` before it reads
`& | < >`: a file named `a&b.csv` would run `b.csv`. So `add` refuses a `--cmd` that uses `%SM_FILE%` outside double
quotes. Quoted, `"%SM_FILE%"` is only a name, because a Windows file name cannot hold a `"`. The relay's name for a
machine is chosen by the machine itself, so it is only in `event.json`, never in the environment.

### The rules it keeps

- **Every rule above still holds.** Never two runs of one entry, one visit per machine, Allow on every visit (the
  Allow card says what started the run), and one failure stops nothing else. A run nobody lets in is recorded as
  **not let in** and waits for the entry's next event. It is never retried.
- **A burst starts one run.** The same event again within the entry's `--debounce` of the run it started is counted
  in `list`, not started. Bursts come from an outage alerting on every machine, a summary opened up, or ten files
  landing together. An event that comes later, while that run still goes, is skipped and counted.
- **One event per burst, so one machine.** With `--host from-alert`, an alert about another machine during the burst
  or the run is counted, not handled, and the relay does not post it again. For a job on each machine, add an entry
  per machine (`--machine <its number>`).
- **A file starts it once.** It is offered when its size and time have held still for two seconds, never while it is
  being written. The same file is never offered again: one changed in place is the same file, and one deleted and
  made again is a new one. A name gone from the folder for five minutes is forgotten, so a later file of that name is
  new, while one empty look at a folder that hiccupped forgets nothing. Files already in the folder when the entry
  was added are never offered, and neither is a download's or an editor's scratch (`.tmp`, `.part`, `.crdownload`,
  `~$name`, `.name`).
- **A file in a burst is counted, not run.** A job that must see every file should handle the whole folder (say,
  everything not yet moved to `done/`), not only the file it was handed.
- **Only a runner that keeps running hears alerts and calls.** `run --once` looks in the folders twice, two seconds
  apart, and starts what has landed.

## An example

```bash
# Once, with a driver: the job as a mission -- planned as milestones, each proven -- then saved as a recipe
node core/agent-join.js --host 10004 --task "export the weekly report" --control --serve ./work/report
node drive/mission.js ./work/report plan @plan.json     # ...work it through: step, achieve, finish
node drive/replay.js save ./work/report export-the-weekly-report

# From then on, every weekday at 08:30, with nobody driving
node drive/schedule.js add --host 10004 --recipe export-the-weekly-report --at 08:30 --days mon-fri
# ...and whenever a CSV lands in the inbox, and when a call says so
node drive/schedule.js add --cmd "node skills/<name>/import.js" --on file:./inbox --match "*.csv"
node drive/schedule.js add --cmd "node skills/<name>/deploy.js" --on http
node drive/schedule.js list
node drive/schedule.js run      # stays in the foreground; Ctrl+C stops it
```

Jobs start only while a runner is running. To keep one going across restarts, start `node drive/schedule.js run`
from your own login items or service manager, or call `node drive/schedule.js run --once --grace 15m` every 15
minutes from the system's scheduler. The kit installs neither of these. A runner started with `--once` looks in the
folders, but it does not hear the relay's alerts or calls.
