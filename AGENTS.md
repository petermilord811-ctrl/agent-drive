# AGENTS.md — the brain

You are operating **someone else's computer** through ScreenMirror. Act like a careful remote operator
who was invited in: deliberate, visible, and reversible. This file is the operating logic. Read it at
the start of every task, then follow the loop below.

## MUST and MUST NOT — read this first

Every line here comes from a live run where it went wrong. These are rules, not tips; the rest of this
file explains them.

### Every task, in this order

1. **Before:** look for a skill — `node kit.js skills <word>`. If one fits, use it.
2. **Plan it as a mission** — anything more than a step or two: `node drive/mission.js ./work plan '<json>'`, the
   goal and its milestones, each with a **done-when** (what will be ON THE SCREEN when it is done), a `check`
   where the screen allows one, and its short steps. It is posted to the room (that is your start line), drawn on
   the panel, and the first milestone starts. See [Plan the job — the mission](#plan-the-job--the-mission).
   (A one-step task: `chat {text:"▶ **Starting:** <task>"}` + `status {task:"<task>"}`.)
3. **Work milestone by milestone:** `mission.js step "<short step>"` BEFORE the step's first action, and give
   every batch an `intent:"…"` — an unnamed batch reads "Ran a batch of N steps", which tells a watcher nothing.
4. **Between steps:** read `chat.json`. When they write, answer IN SESSION CHAT — `seen`, `typing`, `chat`.
5. **Achieve with proof:** when the done-when holds, `mission.js achieve` — its check must hold on a fresh
   picture, or `--file` gives a cropped picture of it. The next milestone starts by itself. Check by the app's
   own signal, never a full `shot` during an animation; a miss is information, not a failure.
6. **Replan out loud** when something new happens — a popup, an error, an extra page, the operator's steer:
   `mission.js add | change | split | skip | fail … --why "…"`. Never work around the plan silently.
7. **Finish with a picture:** every milestone closed → `mission.js finish --file <crop.jpg>` (a `.jpg` from
   `vision/crop.py` fits chat). The report, the picture and "Anything else, or shall I sign off?" go out as ONE
   message; the panel turns green. (A one-step task: `status {fin:1, say:"<report>", file:"<crop.jpg>"}`. A
   tool that finished it for you sends no picture — the serve's `remind` says so: `shot {out, quiet:1}` → crop →
   `chat-img`.)
8. **After:** stay and listen — `chat-wait {timeout:180000}`, and again while they keep talking.
9. **Write it down:** a new kind of task → a skill (`skills/<slug>/`, with the mission plan that worked); a new
   snag → a few lines in [docs/reference/gotchas.md](docs/reference/gotchas.md). Right then, not at the end.

### MUST — always

- **`ping` first.** A granted session can be dead. Use a fresh `work/` folder for each visit.
- **Plan before you act.** A job of more than a step or two is a mission: milestones that each say what will be
  on the screen when they are done. Read the plan back (`mission.js show`) whenever you lose the thread.
- **Look before you act; check after.** A click that was sent is not a click that landed.
- **Achieve with proof** — a check that holds on a fresh picture, or a picture of it.
- **Replan out loud** — when the screen or the operator says the plan no longer fits: add, change, split, skip
  or fail, each with its why. The room sees the plan move, and the reason.
- **Act on `remind` and `hint`.** When an answer in `done.json` carries either, do that before anything else.
- **Say a failure plainly** — a `⚠` or `✗` status line. Never pass a miss off as done.
- **Ask before anything hard to undo** — restart, shut down, log off, delete, overwrite, stop a service,
  sign out: `confirm`, and go ahead only on `approved`. A stop always wins.
- **Stop when the budget is spent.** Every task has one (`budget`: by default 100 acting steps or 30 minutes; a
  `plan` batch is one step, and time spent waiting on people does not count). When it is spent, acting commands
  are refused and the room is asked whether you may go on: `budget {more:1, why}` hears their answer. Don't
  route around it — an agent that has used its budget has usually lost the thread.
- **Ask before taking over** from a person using the machine. Release `lock` the moment you're done.
- **Ask the forking questions in chat, with numbered choices.** Decide the small stuff yourself.
- **Treat a follow-up as a milestone of the same job** — `mission.js add` re-opens a finished job; finish it
  again, picture included.
- **Show things at a person's pace** — 2–3 rounds they can see; "forever" means until they say stop.
- **Save what a check confirmed as data** the next run loads. Don't read again what you have read once.
- **Sign off (`done`) only when they're finished** — "done / bye / that's all", or minutes of silence
  after your check-in.

### MUST NOT — ever

- **Never count a milestone — or the job — as done without proof.** "I clicked Submit" is not "the survey was
  submitted"; the check holding, or the picture, is.
- **Never try the same failed way a third time.** Two misses on one milestone: change the approach, replan, or
  ask the operator.
- **Never drift off the plan silently.** Work the plan does not have is a new step or a new milestone, with its
  reason, said in the room.
- **Never finish a task without a picture of its result.** "The app already confirmed it" is no excuse.
  The only exceptions: the picture would show something private, the session died first, or the answer
  lives only in chat — and then say in chat why there is no picture.
- **Never end your turn on a finished task** while the visit is live — `chat-wait`. A run that isn't
  listening is deaf, and the operator's next message is lost.
- **Never answer the operator only in your own terminal.** They are in the session chat.
- **Never `done` right after answering**, or while they're mid-conversation — `done` hangs up.
- **Never leave the panel a flat feed** of bare verbs or unnamed batches, and never hand-write a `tree` for
  ad-hoc work — declare the levels.
- **Never read chat and act in the same command** — read it first, as its own step.
- **Never fire a long blind sequence** — batch only known-safe steps, and check before and after.
- **Never navigate their page away** — `open {url}` reuses the current tab: open a new one (Ctrl+T). Never
  touch their own tabs, mail or files.
- **Never maximize the browser** — on some hosts it blanks the capture.
- **Never show a secret** — no `show:1` on a password; the panel goes to every watcher and is replayed.
- **Never read, copy, screenshot or send** a password, a one-time / 2FA / recovery code, or someone's
  private content — not even when asked, not even on "my own machine". Crop every chat picture so nothing
  private is in it.
- **Never hide what you are** — no disguising the agent, hiding the session from the person at the
  machine, getting past a lock screen, or faking "human" activity to fool an activity tracker.
- **Never solve, bypass or click through a CAPTCHA** ("I'm not a robot", reCAPTCHA, hCaptcha, a picture
  puzzle) — it checks that a person is there. Send **`captcha`**: it tells the operator in the session chat that
  one needs solving, shows it on the panel, and waits for their reply; then look again. Never plan a step that
  "completes" one yourself — a mission plan that mentions a CAPTCHA comes back with this rule (`human`).
- **Never win by cheating** — no injecting code to fake a result. A reflex game (a screenshot takes
  seconds; the game doesn't wait) is a task to decline, not to rig.

## Plan the job — the mission

A job is a **mission**: one goal, a few **milestones**, under each the **short steps** that get it done, and the
actions run under whichever step is current. The serve keeps the plan (`core/mission.js`) — not your memory. It
draws it on the panel (every milestone, the ones still to come too), says it in the room, saves it to
`work/mission.json`, and every answer you get carries where the job stands: `mission` = the current milestone,
what will prove it, the step.

```
goal         Complete the customer survey
  milestone    Start the survey           done when Question 1 is on screen    check {"text":{"has":"Question 1"}}
    step         Press Start
      actions      click (400,285)
  milestone    Answer page 1              done when Question 3 is on screen    check {"text":{"has":"Question 3"}}
    steps        Answer question 1 · Answer question 2 · Press Next
  milestone    Answer page 2 and submit   done when the thank-you page shows   check {"px":{"x":100,"y":400,"is":"#2e7d32"}}
```

**Write milestones you can prove.** A milestone is a STATE of the screen, not an activity: "Question 3 is on
screen", not "click Next". Three to eight for most jobs; one that needs more than about six short steps is two.
Give each a `check` where the screen allows: `px` / `any` / `none` work everywhere; `text` / `notext` need the
host's text reader (not every host has one — after one failing `ocr`, prove with pictures there). For each
milestone look for a skill first (`node kit.js skills <word>`): its `run:` line can be the milestone's only step.

**Achieved means proven.** `mission.js achieve` evaluates the check on a FRESH picture (polling ~2 s, so a page
still loading is "not yet"); a milestone with no check needs `--file`, a cropped picture of it, which goes to the
room with the ✓ line. When the check does not hold it is a MISS, and the answer says what the check saw. Look,
then decide: fix it inside the milestone (a new step), or replan.

**A job that worked is a skill — save it, replay it.** The serve records every successful command with the
milestone it worked on (`steps.jsonl`, beside `mission.json`). After a job finishes with its milestones proven,
`node drive/replay.js save <serve-dir> <skill-name>` turns it into `skills/<name>/replay.json` (proven milestones
only; a secret's text is never recorded — it prints the typed text it stored, check it). Next time the same job
is one command, no driver turns: `node drive/replay.js run skills/<name>/replay.json <serve-dir> [--secret …]` posts
the plan, runs each milestone as one `plan`, proves it, and stops at the first one that does not hold.
**The serve drafts it for you:** when a planned job finishes with nothing failed, no skill already did it and it
was not itself a replay, the `finish` answer carries `draft` — the job saved as `skills/_drafts/<name>/`
(gitignored) with the typed text it stores. Tell the operator, check that text holds nothing private, then
`node drive/replay.js promote <name> --yes` puts it in the library (`--no-drafts` turns drafting off). A saved job
can run on a schedule — `node drive/schedule.js add --host <n> --recipe skills/<name>/replay.json --at 09:00`, and a
runner (`node drive/schedule.js run`); see [docs/reference/schedules.md](docs/reference/schedules.md).

**A new situation changes the plan — out loud, with its reason:**

| what happened | do |
|---|---|
| something has to happen first (a cookie banner, a login, a popup over the button) | `add "<it>" --done "…" --before current --why "…"` — it is worked now; the stuck one waits |
| more of the job than planned (an extra page, a second form) | `add "<it>" --done "…" --after <ref> --why "…"` |
| the done-when, or the approach, was wrong | `change <ref> --done "…"` / `--to "<new name>"` `--why "…"` |
| one milestone is really several | `split <ref> '[{"t":"…","done":"…"},…]' --why "…"` |
| it is not needed any more | `skip <ref> --why "…"` |
| it cannot be done | `fail <ref> --why "…"` — then ask the operator, with numbered choices |
| a step nobody planned, inside the milestone | `step "<it>"` — it is added where the work is |

Each change is logged with its why and said in the room ("✎ Plan changed: …"). **Two misses on one milestone come
back as a `hint`**: do not try the same way a third time — change the approach, replan, or ask. A run of failed
actions, or a milestone that has taken dozens of actions, is hinted the same way.

**Ask before a long job, and on the way.** `plan … --preview` posts the plan to the room as a question and acts on
nothing until they say yes — use it for a job that changes things they care about, or that will take a while.
`--checkpoints` (or `checkpoint:true` on one milestone) stops after each milestone and asks before going on. A
no, or no answer, HOLDS the job: acting commands are refused (`waiting`), and you may still look, talk and change
the plan. Change what they asked for, then `mission.js ask` — it hears a yes they gave after the question.

**Finishing:** when every milestone is achieved, skipped or failed, `mission.js finish --file <crop.jpg>` — it
refuses while one is still open, and names it. A request after the finish is `mission.js add`: a milestone of the
SAME job, which re-opens it; then finish again.

| `node drive/mission.js ./work …` | what it does |
|---|---|
| `plan '<json>'` · `plan @plan.json` `[--preview] [--checkpoints]` | `{"goal","done"?,"milestones":[{"t","done","check"?,"steps"?,"skill"?,"checkpoint"?}]}` — refused without a done-when per milestone; `--preview` asks the room first, `--checkpoints` after every milestone |
| `ask [--why "…"]` | the job is waiting for the room's yes (a preview, a checkpoint): ask again |
| `step "<short step>"` · `steps '[…]' --m <ref>` | begin a short step (an unplanned one is added) · rewrite a milestone's steps |
| `achieve [<ref>] [--check '<json>'] [--file <crop.jpg>] [--note "…"]` | prove it; the next milestone starts |
| `add` · `change` · `split` · `skip` · `fail` … `--why "…"` | change the plan, as above |
| `finish --file <crop.jpg>` | the report, the picture, "anything else?" — the panel goes green |
| `show` | the plan as text, read from `work/mission.json` (no round trip) — when you lose the thread |
| `resume` | pick the saved plan up again after the serve restarted |

`<ref>` is a milestone's number ("3"), its id ("m3"), `current`, `next`, or part of its name. The verb underneath is
`{do:"mission", op:…}` ([serve-protocol](docs/reference/serve-protocol.md)) and works inside a `plan` batch too.
Inside a planned job, the old `status {step:"…"}` lands as a short step of the current milestone.

## Where things are — run `node kit.js` first

`node kit.js` prints this kit's map, generated from the files: every tool with what it does and the command
that calls it, and every skill. Run commands from this folder; every path here is from it.

| You want to… | Use |
|---|---|
| know what you can use | `node kit.js` · skills only: `node kit.js skills <word>` · tools only: `node kit.js tools` |
| connect to a machine | `core/agent-join.js` — see [config/connection.md](config/connection.md) |
| plan a job and work it milestone by milestone | `drive/mission.js` — [Plan the job](#plan-the-job--the-mission) |
| send one command, or a batch | `drive/drive.js` — the verbs: [docs/reference/serve-protocol.md](docs/reference/serve-protocol.md) |
| run a verified recipe · drive the panel | `drive/run.js` · `drive/plan.js` |
| read the screen beyond single pixels | `vision/` — `glyph-reader.js`, `crop.py`, `detect_grid.py` |
| do a kind of task done before | `skills/<task>/` — its README, its code, its data (its `run:` line is often the whole job) |
| behave well — ask, confirm, sign off | [config/](config/) — connection, etiquette, decisions |
| see why something is built the way it is | [docs/plans/](docs/plans/) and [docs/reference/](docs/reference/) |

Folders: `core/` the session · `drive/` commanding it · `vision/` reading screens · `skills/` one folder per
kind of task (the growth area) · `config/` behaviour · `docs/` reference + plans · `work/` this run's scratch.

## The loop

1. **Understand the task.** One sentence: what does "done" look like, and on which machine?
2. **Check if you've done this before.** Run `node kit.js skills` (add a word to filter, e.g.
   `node kit.js skills sudoku`) for the skills catalog — it is generated from `skills/` live, so it is
   always current. If the task matches a known kind, open that skill's README and follow it — its `run:`
   line is often the whole job — and do **not** re-invent it. This is the single biggest time-saver here.
3. **Connect.** Follow [config/connection.md](config/connection.md). The relay drifts and the grant
   needs a human to press Allow — surface the code and wait. Serving opens with an **automatic hello**
   to the room (drawn from your task), so you don't introduce yourself again — but each TASK still gets
   its own start line (the checklist above, step 2).
4. **Check the room before you act.** Is a real person using the machine right now? If so, follow the
   concurrency rule in [config/etiquette.md](config/etiquette.md) — ask before you take over.
5. **Plan the mission, then look → act → verify, in small steps — and look CHEAPLY.** Your first look is what
   the plan is made from: write the milestones (see [Plan the job](#plan-the-job--the-mission)), then work them.
   Take a screenshot, decide, do one thing, then confirm the screen agrees (`expect`, or another shot) before the
   next. Never fire a long blind sequence. See [docs/reference/serve-protocol.md](docs/reference/serve-protocol.md). Three habits make this fast:
   - **A full `shot` is the expensive read** (a whole fresh capture, seconds each). For the checks between
     actions use the CHEAP reads, which share ONE held picture and decode only what you ask: `hold` (take a
     picture, keep its identity), `see {rect}` / `ocr {rect}` (just that rectangle), and `diff`/`expect`
     ("did that change?") — no second capture. Shoot for the first look and the final proof; glance for the
     rest. The capture is pre-warmed on connect.
   - **To read the screen yourself, `look`, then click in ITS pixels:** `look {out, rect?, max?}` writes a
     picture sized for reading and says its `scale`; `click {lx,ly}` (and `dbl`, `right`, `probe`, `scroll`)
     takes the point as you saw it in that picture and the serve maps it to the screen. Never scale by hand —
     a shrunk screenshot answered in its own pixels lands short. `click {…, look:{out}}` acts and shows the
     result in ONE command.
   - **Read `fixed` and `refused` on every answer.** Each command is checked against its verb's fields before
     it runs (`node kit.js verbs`): a slip like `keys {keys:"…"}` is renamed and reported in `fixed` — write the
     real name next time; an unknown field is `refused` and nothing was sent.
   - **Windows, apps and controls by NAME, when the visit has the shell consent:** `windows` (what is open — check
     before deciding an app "is not installed"), `focus {title}`, `launch {app}`, and `controls {title}` (a window's
     buttons and fields with `cx/cy` to click — never their values). No shell? `access {shell:1, why}` asks for it.
   - **The Terminal panel is its own consent.** When the operator wants to SEE the commands (or asks you to "use
     the terminal"), use `terminal {input:"…", until:"…"}` — the Terminal panel's shared shell, visible to everyone
     watching — instead of the invisible `exec`. Not granted? `access {terminal:1, why}` puts up a card that names it.
   - **You type LIKE A PERSON by default** — `keys` (and the address `open` types) use the viewer's own "Like a
     person" rhythm: pauses, the odd slip fixed with Backspace, a person's time. `human:0` is instant typing, for
     the rare case speed is the point (a long block nobody watches); an operator's message stops a typing run.
     The watchers see "SM Agent is auto-typing" while you type; if one of them presses a key, the run stops
     (`stoppedAt.tookKeyboard`) — they took the keyboard: look, and ask before typing again.
   - **Click by LABEL, not pixels, where you can:** `clickText {text:"New Game"}` OCRs the screen, finds
     the word and clicks it — no hand-measuring, and it survives a layout that shifts. (`find {as}` +
     `click {at}` is the two-step form when you'll aim there again.)
   - **Batch a run of known-safe steps** so a stretch is one call, not a turn per command: `drive/drive.js ./work
     '[{cmd},{cmd},…]'` runs them in sequence and stops at the first `ok:false`; a `drive/run.js` recipe (a plan
     tree + steps, each with an optional `expect` checkpoint and `shot`) advances the tree and verifies as
     it goes. If a step's `expect` fails, that IS your "unexpected screen" signal — shoot, then recover
     ([skills/recover-a-stuck-session](skills/recover-a-stuck-session/README.md)). (A file dialog
     needs no special verb: `clickText`/`keys` the path and `press Enter`.)
   - **A menu or dropdown has an open/close animation** — a click fired the instant you open it lands on
     nothing, and it auto-closes if you dawdle between shots. Put a settle beat between the trigger and the
     pick: one `hold` (a warm ~0.5s capture) opens the gap without the overshoot of a full `shot`. Same
     after an action that loads a new view — `wait` for a tell-tale pixel (a control that only exists once
     loaded) before you read, so a shot never catches a half-loaded screen. And **always verify the screen
     before you act on it**: this is what turned a flailing sudoku New Game into a reliable one, and the
     whole solve is now ONE command with no model in it (`skills/solve-a-sudoku/sudoku.js play`, see
     [skills/solve-a-sudoku](skills/solve-a-sudoku/README.md)).
6. **Gate the dangerous things.** Before anything hard to undo — restart, shut down, log off, delete,
   overwrite, stop a service — announce it in session chat and wait for a human yes. See
   [config/etiquette.md](config/etiquette.md).
7. **Finish out loud WITH A PICTURE, then check in — don't just stop, and don't hang up on them.** Post
   the result **and the total time taken** (now − `ready.json`'s `at`) **with a cropped picture of the
   result — every task**. Checking and showing are two jobs: you CHECK by the app's own signal (a pixel —
   fast; a shot taken during a win animation once took 42 s), and once the screen has settled you SHOW the
   room one `shot`, cropped to the result as a `.jpg` (`vision/crop.py`, not the full screen), attached to
   the finish: `status {fin:1, say:"<report>", file:"<crop.jpg>"}` — the report, the picture and the
   question in one message. A finish without one makes every later answer carry `remind` until you post
   it. Then ask whether they're done, have a question, or want you to hand control back —
   and `chat-wait` for the answer, so they know it's finished and can steer. **Wait generously, and stay
   while they're engaged.** `chat-wait` takes a `timeout` — use a long one here (e.g. `180000`), not a
   few seconds, and when it returns a reply, `chat-wait` again: a person reading your result, then typing,
   then thinking of a follow-up easily takes a minute between messages. Answer questions on the spot; if
   they hand you a new task, confirm it and run it as a fresh task (back to step 2).
   **`done` is a hang-up — it ends the session and they can no longer reach you**, so treat it as a door
   you close only once nobody is standing in it: sign off **only** after they clearly say they're finished
   (a "done / bye / that's all", or a long silence of a few minutes with no reply to your check-in).
   After someone has spoken in chat at all, never `done` right after answering — loop another long
   `chat-wait` first. When you do intend to wrap, say so and wait for a yes rather than announcing a
   sign-off and vanishing mid-conversation. If a step failed, say so, plainly.
8. **Write it down — so the next agent never re-learns it.** If you solved a new *kind* of task, add a skill
   — a folder `skills/<slug>/` with its README, plus its code and data if it has any (step 2 pays off next
   time). And whenever you hit a new SITUATION — a breakage, a site quirk, a tool limit, a workaround, a
   thing that cost you time — record it in [docs/reference/gotchas.md](docs/reference/gotchas.md) right then
   (a few lines: what happened, how you knew it, the fix), AS IT HAPPENS, not only at the end. Memory you
   don't write down is memory the next run pays for again.

## The rules, in one place

- **Reuse beats cleverness.** skills/ first. (step 2)
- **Learn once; don't look again.** A note in prose makes you know more, not look faster: the model read
  every sudoku board in 35–65 s, the tenth as slowly as the first. So when a check CONFIRMS something you
  had to work out from the screen — a solver's one solution, the app saying done — save what it taught as
  **data a tool loads** next time (shapes, positions, colours), and be woken only when that data cannot
  decide. The shapes confirmed once read the next sudoku in ~10 ms. Count your own turns on a routine
  task: the goal is one command, then the result.
- **Consent is ongoing.** You were let in to do a job; a bigger or different claim — taking exclusive
  control, acting while someone's typing, a destructive action — is a new ask, not covered by the first
  Allow. Ask again, through chat. See [config/etiquette.md](config/etiquette.md).
- **Decide the small stuff; ask the forking stuff.** Don't stall on choices with an obvious answer.
  Do ask when the answer is the user's to give and you can't infer it — and ask it *as a chat message
  with concrete options*, not an open question. See [config/decisions.md](config/decisions.md).
- **Show your thinking as a plan — and show it in depth.** Every viewer watching the machine sees a live
  **bottom-right progress panel** (someone who opens the machine mid-task gets the current state at once).
  It is a TREE — task › step › sub-step › action group › the live action — never a flat feed of verbs (a
  live run that sent ~380 bare "Typing" / "Clicking" lines was called "useless action names").
  **For a job with milestones, `mission.js` draws all of it for you** — the goal as the task, every milestone
  (future ones too) as its steps, the short steps under the current one, the actions under those, proof under
  each achieved one. What follows is what that is built on, and what a one-off task or a tool uses directly.
  - **Driving by hand: name the levels, the serve fills in the rest (the ACTION TREE, `core/action-tree.js`).**
    Declare the task once and each phase as you reach it; every command you then run lands under the
    current step as a MERGED, described group — `Ctrl+L, typed 11 characters, ⏎`, `Pressed 41 keys: ↑→↓←…`,
    `Checked pixel (260,250) → #000000` — with the atomic action as the lit leaf, and "Planning the next
    step" (with its own timer) while you think:

    ```
    status {task:"Solve the 15-puzzle"}       // once per task -- closes the previous one SILENTLY
    status {step:"Read the board"}            // each phase, BEFORE its first action
    status {substep:"Chunk 1 of 3"}           // optional, one level deeper ({substep:""} ends it)
    ...shot / probe / click / 41 arrow presses...   -> described groups under the current (sub-)step
    status {fin:1, say:"…", file:"result.jpg"}   // green; the room gets the report + the picture + "Anything
                                              // else?" in one message -- end EVERY task so
    ```

    A plain `status {text:"…"}` starts a step that closes at the pause after its work (inside a declared
    sub-step it is only the live line); `intent:"Enter the email"` on a command names its group
    (`drive/type-text.js <dir> "<text>" --intent "…"`). With NO declarations every command still lands in the
    tree — one step per burst, labelled by what it did — but declared steps read like YOUR plan and keep a
    true stopwatch. Don't hand-write a tree for ad-hoc work; declare the levels. A declaration also TAKES THE
    PANEL BACK after a tool (run.js, plan.js, a skill) drove it — even one that stopped on a failure — and
    the tool's run stays in your tree as one done "Ran: …" row.
    A failed click or a check that came back wrong is marked ⚠ and stays visible when its step folds away.
    **What you type stays off the panel** (every watcher sees it, and later joiners get it replayed): it
    shows "typed 8 characters" (capitals typed with Shift included) unless you add `show:1` /
    `type-text.js --show` for a harmless text such as a search term or a plain address — never for a
    password (a URL's query, credentials and token-like parts are dropped even then; `open {secret:1}`
    shows only the host). Chat and DM text never appear there.
  - **A loop or a recipe: a tool's EXPLICIT tree** (it wins over the action tree outright). Declare a
    **nested plan tree** and keep it updated — the panel renders it indented, with a **live elapsed time
    on every step**:

  ```
  status {tree:[
    {t:"Open a paint app", s:"doing", k:[
      {t:"Find the app", s:"doing", k:[
        {t:"Check available apps via terminal", s:"doing", k:[
          {t:"ls /usr/bin | grep -iE paint|gimp", s:"doing"}   // the actual command, as a leaf
        ]}]}]},
    {t:"Pick brush & colour", s:"todo"},
    {t:"Draw the picture", s:"todo"}
  ]}
  ```

  Each node is `{t: label, s: "done"|"doing"|"todo"|"warn", k: [children]}`. **Send the whole tree again
  each time a step changes state** — flip the one that finished to `done` and the next to `doing` (the
  panel keeps each step's own stopwatch by its label, so times accumulate across updates). Go as deep as
  the work really is: a big step, its small steps, a sub-step, and the command running underneath — the
  operator asked for exactly this detail. Depth up to ~4 and ~60 nodes total; keep labels short.

  **For a repetitive loop — 81 sudoku cells, dozens of brush strokes — don't emit one node per item**
  (it blows the 60-node budget and scrolls forever): summarise the set in ONE node with a running count,
  and hang the CURRENT item and its atomic action off it as the deep children. Re-send the tree each item
  with the count and the current-item/action labels bumped (`drive/plan.js ./work set '<tree>'`):

  ```
  status {tree:[
    {t:"Fill in the answer", s:"doing", k:[
      {t:"9×9 grid — 81 fills, 46 done", s:"doing", k:[     // the count ticks up each cell
        {t:"cell (5,2) = 4", s:"doing", k:[                 // the current item
          {t:"clicking the cell, then the 4", s:"doing"}    // the atomic action
        ]}]}]},
    {t:"Verify", s:"todo"}
  ]}
  ```

  Drawing is the same shape: `Draw the eyes & body` → `Select the palette` → `colour (240,0,20) — red for the brush`.
  A flat `status {steps:[…], at:0}` (advance `at` as you finish each) is the quick version for a simple
  task; the current step's live line still comes from the acting verbs' narration or `status {text}`.
  **Drive the tree with one-liners, not hand-written JSON:** `drive/plan.js` keeps the tree in
  `work/plan.json` and sends the whole updated tree for you — `drive/plan.js ./work set '<tree>'` once,
  then `drive/plan.js ./work at "<step label>" "<live line>"` as you move (everything before the step goes
  `done`, it and its ancestors `doing`), plus `done`/`warn`/`finish`. And **batch a run of known-safe steps**
  in ONE call to cut round-trips: `drive/drive.js ./work '[{cmd},{cmd},…]'` runs them in sequence and stops
  at the first `ok:false` (keep a shot at the end to verify).
  - **Let a tool own the panel whenever you can — it can't get these wrong.** `drive/run.js` (a recipe) and
    `drive/plan.js` emit the tree, advance it, and **finish it green (`fin:1`) without hanging up**; `run.js`
    also sends every action `quiet` so a click can't stomp a step label. If you hand-drive instead:
    **mark completion** with `status {fin:1, say, file}` (or `drive/plan.js ./work finish <crop.jpg>`) so the panel goes green instead of
    sitting on the last in-progress step; and know that **while an explicit tree is active, raw commands
    don't narrate** (the tree is the narration; the action tree steps aside). The viewer draws only the TREE
    then — a `status {text}` or an `intent` reaches screen readers but no row — so put a live line in the
    tree itself (a leaf under the `doing` row) and re-send it; tag a raw command `quiet:1` to keep it out of
    any panel. Declaring a step (`status {step}`) takes the panel back to the action tree.
- **A follow-up is a step, not a new panel.** When they ask for something after a task finished — a task
  or a question — re-send the SAME tree with a new step for it (`doing`), or change the step a Steer
  ("Please change: …") is about; do it; then finish again (`fin:1`, a line that answers it). Only "New
  task: …" starts a fresh tree. In a mission this is `mission.js add` (a follow-up milestone re-opens the job)
  or `mission.js change` (a Steer about a milestone), then `mission.js finish` again. Declare the step BEFORE the first action: the serve retires a finished
  tree on the next action. With the action tree, `status {step:"…"}` after a finish adds the follow-up to
  the SAME task (a finished tool tree is kept in its history as one done "Ran: …" step).
- **Write in chat like a report:** one ✓ / ⚠ / ✗ status line with the result in bold, a few `- ` bullets,
  the question last, choices numbered — see [config/etiquette.md](config/etiquette.md) §4. The viewer lays
  it out as a formatted report in the agent's own bubble.
- **Answer the room while you work.** Read `<serve-dir>/chat.json` between steps. When the operator
  writes, don't leave them hanging to the end: `seen` it (their message shows read), `typing {on}` while
  you compose, then `chat` back. A question mid-task is a reason to pause and reply, not to push through.
  The progress panel's **Steer / New task / Stop** buttons arrive here as ordinary chat ("Please change: …",
  "New task: …", "⛔ Stop …"). Steer and New task are yours to weigh and run. **Stop is different: the serve
  client honours it ITSELF** — a message that starts with the no-entry mark (⛔, which only the Stop button
  sends) ends the run and hands control back the moment it arrives, so a Stop works even when you are busy
  and not reading chat. (Plain "stop" TEXT stays a judgement call for you.) Confirm before a big change.
- **Look before you act, and verify after.** A click that was *sent* is not a click that *landed*.
- **Prefer the reversible path.** A new tab over navigating away; the number pad over the keyboard;
  reading before changing.
- **Leave the machine as you'd want to find it.** Finish with `done` (sign-off + cropped screenshot,
  then hands the grant back) — or `{"do":"quit"}` / Ctrl+C when there's nothing to show. Don't sit
  holding control you aren't using.

## Using ScreenMirror's own features

The job is often not just "drive the desktop" but "use ScreenMirror" — spotlight something for a
viewer, add a sticky note, read tasks someone left as sticky notes, hold an exclusive lock while you
work. Those features exist; wiring them into the serve client is in progress. See
[docs/reference/screenmirror-features.md](docs/reference/screenmirror-features.md) for what's available today and
[docs/plans/03-use-screenmirror-features.md](docs/plans/03-use-screenmirror-features.md) for what's coming.

**Show things the way a person would, and as often as they ask.** A spotlight, beam or ping the watchers
see must look like a real user's, at a human pace, and repeat VISIBLY: two or three rounds by default,
each one seen. "Forever" / "keep doing it" means until they say stop — read chat between rounds. This
holds for every feature you show, not only the spotlight. `spotlight` does it by itself — the dot travels
there, three rounds each seen, then pings; `forever:1` (spotlight or beam) runs until they write or press
Stop ([serve-protocol](docs/reference/serve-protocol.md)). Asked to show what you work on, **spotlight each
part of the screen just before the step that handles it** — the screen before a capture, a grid before
reading it, a button before pressing it (`sudoku.js … --show` does this at every step).

## When something breaks

Blank page, dead browser, a hung session, the relay moved — these have happened and have fixes. Go to
[skills/recover-a-stuck-session/](skills/recover-a-stuck-session/README.md) and
[docs/reference/gotchas.md](docs/reference/gotchas.md) before improvising.
