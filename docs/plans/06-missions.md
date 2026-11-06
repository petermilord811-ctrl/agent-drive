# 06 — Missions: the big plan, milestones, proof, replanning out loud

**Asked for (2026-10-27):** "If I give you a task, you make a big plan … each plan has its short plan, and each short
plan has its actions. The plan can be changed or added to when you face a new situation. You look not good enough at
doing task by task, and changing or adding milestones — deep improve it. Achieving the milestone is the most important
thing; prove it by completing a survey on your own."

## What was wrong

- **The plan lived in the driver's head.** The panel (the action tree, plan 01) showed what had *happened* — never
  what was still to come. A watcher could not see the job, only the last few clicks.
- **"Done" meant "tried".** Nothing distinguished a step that worked from a step that was merely attempted; a
  milestone was "done" when the driver said so.
- **Plans changed silently.** A detour around a popup, an extra page, a different approach — each happened inside a
  burst of clicks, with no record and no reason anyone could see.
- **Repeating the same failure.** Nothing counted misses, so the same failing action could be tried again and again.
- **Losing the thread.** On a long job the driver's context fills; the plan, held only there, decays.

## The design

A **mission** is kept by the serve (`core/mission.js`, pure, behind the `mission` verb in `core/agent-join.js`):

```
mission     goal + how we know the whole job is done
  milestone   a checkpoint you can PROVE: name, done-when (the screen state), check? (a predicate), steps
    step        a short plan; the actions run while it is current land under it (the action tree)
```

The rules, each enforced in code:

1. **A plan without done-whens is refused.** Every milestone says what will be on the screen when it is done — the
   thing that makes it provable at all.
2. **Achieved means proven.** `achieve` evaluates the milestone's check on a FRESH picture (polled briefly — a page
   still loading is "not yet"), or takes a picture of it, which goes to the room. No check and no picture is refused.
3. **The plan changes out loud.** `add` / `change` / `split` / `skip` / `fail` each need a `why`; each is logged in
   `mission.json` and said in the session chat ("✎ Plan changed: …").
4. **Milestone by milestone.** One current milestone while the job is open; achieving it starts the next at once. A
   milestone added *before* the current one is what has to happen first: it becomes current, the other waits (its
   time and history kept, the SAME panel row when it resumes). Finishing requires every milestone achieved, skipped
   or failed — and names the ones still open.
5. **Misses are counted and hinted once.** Two misses on one milestone: change the approach, replan, or ask. Three:
   ask the operator. Three failed actions in a row: look before acting again. Forty actions without being achieved:
   is it still the right milestone?
6. **The plan rides every answer.** `mission` (`{at, when, step, acts, tries, done, of}`) is attached to every reply
   while a job is planned, so the driver works from the plan rather than from memory; `mission.js show` reads the
   whole plan back from disk with no round trip.

## What the watchers see

The action tree gains a **plan mode**: with a skeleton set (`AT.setPlan`), the task's rows are the milestones in
PLAN order — the future ones as rings — the current one open with its short steps (the done ones, the live one with
its actions, the planned rest), each achieved one with a "proven: …" row, skipped / failed ones as rings with their
reason (never a ✓, and never amber, which the viewer reads as live). A milestone's row is keyed by its id, so a
rename or a resume keeps its history and its stopwatch. Windowed around the current milestone (older achieved ones
fold into one row, far-future ones into "+N planned") so a 30-milestone job stays inside the relay's clamp — tested at
every step of such a job.

In the room: the plan (📋, numbered, each with its done-when), each change with its why (✎), each milestone achieved
(✓ n/N, with its picture when that was the proof), and the report at the finish — one line per milestone with its
time or its reason, how often the plan changed — with the picture of the result and "Anything else, or shall I sign
off?" in one message. A tool that finishes its own part mid-job reports without the sign-off question.

## Interplay

- **Old habits keep working.** Inside a planned job `status {step}` becomes a short step of the current milestone; a
  `status {task}` naming another job drops the plan (said in the room); a bare `status {fin}` with milestones open
  gets a hint. A tool's explicit tree still takes the panel; the next mission operation hands it back (one "Ran: …"
  row inside the current milestone).
- **Follow-ups.** `add` on a finished job re-opens it: the follow-up is a milestone of the SAME job (plan 01's
  "follow-ups extend the tree", as a mission).
- **Restarts.** `mission.json` is written after every change; `resume` picks it up in a restarted serve.

## Proof

`tests/mission_survey.js` — a stand-in survey site (real pixels, OCR from what it shows, clicks and typing) against a
real relay and the real client, driven through `drive/mission.js` exactly as AGENTS.md says: a consent banner that
swallows the first click (a miss, then a milestone added before the stuck one), a required question left blank
(missed twice — the hint — then read and answered), every answer given, the report and the picture in one message.
`tests/mission_core.js` pins the engine and the panel's plan mode.

## Next

- A **live** survey run (a SurveyJS demo or an automation-practice form) — record it in the skill.
- **Mission recipes:** a mission whose milestones carry their actions and checks is a runnable recipe — replay a
  proven job with zero model turns, stopping (and handing back) only at the first milestone that does not prove.
- A viewer touch: show "milestone 2 of 5" in the panel header for a planned job (today the header names the current
  milestone; the count is in the tree itself).
