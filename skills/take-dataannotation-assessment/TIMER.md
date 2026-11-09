---
name: ScreenMirror Part B timer (HARD MUST)
when: after Start assessment on a real take — before any field fill; every assessment leaf while autofilling
tags: dataannotation, timer, status, mission, pacing, screenmirror
---
# Part B — ScreenMirror timer (HARD MUST)

**Operator rule (2026-11-08):** After **Start assessment**, turn on the ScreenMirror timer and **record elapsed time for every filled step**. Skipping this is a workflow fail — same severity as Submit without approval.

This is the ScreenMirror **progress-panel stopwatch** (`status` / `mission` tree), not the DA site “Expires in” badge.

## 1. Arm the timer (immediately after Start assessment)

Before Instructions / any field:

```text
status {
  task: "DA Part B — {Role} / {Profile}",
  tree: [
    { t: "0 Preflight", s: "done" },
    { t: "1 Start assessment", s: "done" },
    { t: "2 Fill steps", s: "doing", k: [
        { t: "Step 1 · Instructions", s: "todo" },
        { t: "Step 2 · …", s: "todo" },
        … every leaf from playbook / sidebar …
      ]},
    { t: "3 Recheck", s: "todo" },
    { t: "4 Operator review", s: "todo" }
  ],
  text: "Timer armed — bio {min}–{max} min",
  conf: "high"
}
```

Optional but preferred: `mission { op: "plan", goal, milestones }` with the same leaves so the panel keeps a durable plan.

Also append to `{profile}/answer.timer.json`:

```json
{ "event": "start_assessment", "at": "ISO-8601", "host": "99588", "slug": "…", "bioMinutes": { "min": 90, "max": 120 } }
```

## 2. Record every step (HARD)

For **each** playbook leaf (`firstInStep` or new sidebar step), **before** pause/type/click:

1. `status { step: "Step k · {leaf}", text: "filling {id}", conf: "…" }`  
   — opens / continues the panel **step stopwatch** (elapsed accumulates by label).
2. Fill that step (playbook `pauseMs` + recipe). Prefer sidebar jump over sticky Next.
3. When the leaf is done: re-send `tree` with that leaf `s: "done"` and the next `s: "doing"`.
4. Append to `answer.timer.json`:

```json
{
  "event": "step_done",
  "step": 3,
  "leaf": "Question 1 chart",
  "ids": ["q1a"],
  "at": "ISO-8601",
  "pauseMs": 12000,
  "note": "optional"
}
```

Do **not** batch multiple leaves under one `status.step` — one leaf = one timed step.

## 3. Finish

After recheck, before waiting for Submit:

```text
status { step: "3 Recheck", … }
… then …
status { step: "4 Operator review", text: "awaiting Submit / fix" }
```

On operator Submit yes → fill Submit → `status { fin:1, say: "… total panel elapsed …", file: cropped.jpg }`.  
On sign-off without Submit → `status { fin:1, say: "signed off — timer log in answer.timer.json" }` (no Submit).

## 4. What does NOT count as the timer

| Not enough | Why |
|------------|-----|
| Only `chat` “started fill” | No panel stopwatch |
| Only DA “Expires in: 5 days” | Site clock, not ScreenMirror timer |
| One `status {text}` for the whole assessment | No per-step elapsed |
| Starting timer after Q1 | Must arm **right after** Start assessment |

## 5. Playbook contract

`answer.playbook.json` MUST include:

```json
"timer": {
  "must": true,
  "armAfter": "Start assessment",
  "tool": "status (+ optional mission)",
  "log": "{profile}/answer.timer.json",
  "perLeaf": "status.step before fill; tree flip done; append log"
}
```

`prepare-answer.js` emits this block. Agents must follow it even if an older playbook omitted it.

## Evidence

Missed on 99588 Daniel Herman / Data Scientist Part B (2026-11-08 evening) — Start assessment without arming `status`/`mission` tree; no per-step elapsed. Operator: **must**.
