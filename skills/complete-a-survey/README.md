---
name: Complete a survey or a web form
when: fill in a survey, questionnaire or multi-page web form and submit it -- page by page, each page proven before the next
tags: browser, survey, form, questionnaire, multi-page, mission, milestones, verify
run: node drive/mission.js ./work plan @skills/complete-a-survey/plan.example.json
---
# skill: complete a survey (or any multi-page form)

A survey is the clearest case of a job that is a **mission** ([AGENTS.md](../../AGENTS.md#plan-the-job--the-mission)):
a goal (the survey submitted), milestones you can PROVE (each page answered — the next page's first question is on
screen), short steps under each (read the questions, answer each, press Next), and new situations along the way
that change the plan (a consent banner, a required question left blank, an extra page nobody expected).

## The flow

1. **Open it in a NEW tab** (Ctrl+T, type the address, Enter) — never navigate the person's own page away — and
   take ONE look (`shot` + `vision/crop.py` to read it). That look is what the plan is made from.
2. **Plan it.** Copy [plan.example.json](plan.example.json) to `work/plan.json`, put in the real address and what
   you saw: one milestone per page when you can see how many pages there are ("Page 2 of 4"), else the first page
   plus "Answer the remaining pages". `node drive/mission.js ./work plan @work/plan.json` — posted to the room, drawn
   on the panel.
3. **Give each milestone a check** where the screen allows: the NEXT page's first question
   (`{"text":{"has":"Question 3"}}`) on a host with a text reader, or a colour only that page has
   (`{"any":{"rect":{…},"is":"#…"}}`) — the completion page is usually easy (a big tick, a coloured panel). With no
   check, prove a milestone with a cropped picture: `achieve --file <crop.jpg>`.
4. **Work a page:** `mission.js step "Answer question 1"` → click the option (aim at the BOX or circle, not the
   label's far end) → next step… → `step "Press Next"` → click → `mission.js achieve`. A text answer: click the
   field first, then `drive/type-text.js` (it types one key per command — `keys` drops characters on some hosts).
5. **A miss is information.** The page did not move on: look at it. A red message ("This question is required",
   "Please answer every question") means a question is blank — find it (it is usually outlined red), answer it as a
   new step, press Next again. Two misses on one page come back as a hint: do not press Next a third time
   blind — read the page.
6. **Submit and finish:** the last milestone is the completion page. Then `shot`, crop the completion message
   (leave out anything private), `mission.js finish --file <crop.jpg>`.

## The answers — whose they are

- **The operator's answers come first.** If they gave answers, use exactly those.
- **None given, on a test or demo survey** (an automation-practice form, a SurveyJS demo): choose plain, neutral
  answers, and say in the report which ones you chose.
- **Never invent personal data** — a name, email, phone, address, date of birth, payment details. Ask, with
  numbered choices ("1. use test@example.com, 2. you type it, 3. skip this survey").
- **Never solve a CAPTCHA** or "prove you're human" check — that is the site asking for a person. `mission.js fail`
  is wrong too; ask the operator to do that one step, then carry on.
- **An attention check** ("select 'Agree' for this question") is an instruction: follow it.

## New situations seen on surveys — and the change to the plan

| what happened | the change |
|---|---|
| a cookie / consent banner covers the page and swallows clicks | `add "Accept the cookie banner" --done "the banner is gone" --before current --why "…"` |
| more pages than planned ("Page 3 of 5") | `add "Answer page 3" --done "…" --after current --why "the survey has 5 pages"` (one per page) |
| a page asks for personal data | ask (numbered choices); then `change` the milestone, or `skip` it if the operator says so |
| a login / sign-up wall before the survey | ask the operator — it is their account, their call |
| Next is disabled until something is answered | a new step for the unanswered question — not a new milestone |
| the survey ends early ("you do not qualify") | `fail` the remaining milestones with that reason; report it plainly |

## Proven

- **`tests/mission_survey.js`** completes a stand-in survey end to end against a real relay and the real client: a
  consent banner swallows the first Start click (a MISS: the check saw "we use cookies"), the plan gains "Accept the
  cookie banner" before "Start the survey" (said in the room, with the reason), page 1's Next is pressed with a
  required question blank — twice, and the second miss comes back as a hint — the page's error is read, the
  question answered, every answer given, and the report and the picture arrive as one message (37 checks).
- **Live:** not yet run on a real survey — record the first live run here (host, site, milestones, what changed in
  the plan and why, the time).
