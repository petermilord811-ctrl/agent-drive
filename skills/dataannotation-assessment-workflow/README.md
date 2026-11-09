---
name: DataAnnotation assessment workflow
when: full DataAnnotation.tech worker path — create account → setup profile → pick assessment role → take assessment (capture skills/.../problems/problems-{type}.md, re-catch/diff, answer); also when operator says DA workflow, full assessment, onboard, or browse roles after signup
tags: browser, forms, dataannotation, assessment, onboarding, profile, resume, problems, firefox, mission
run: node skills/dataannotation-assessment-workflow/pick-assessment.js --resume path/to/resume.txt
---
# skill: DataAnnotation assessment workflow

Orchestrates the **four big platform steps** on DataAnnotation.tech.

| Big step | Screen cue | Skill / action |
|----------|------------|----------------|
| **1. Create account** | `worker_signup` | [`create-dataannotation-account`](../create-dataannotation-account/README.md) |
| **2. Setup profile** | `workers/learn-about-you` — Welcome → Availability | [`setup-dataannotation-profile`](../setup-dataannotation-profile/README.md) |
| **3. Choose assessment** | `workers/projects` — “Browse roles” / Assessment step 2 | [`pick-dataannotation-assessment`](../pick-dataannotation-assessment/README.md) |
| **4. Real assessment** | role assessment / work mode | [`take-dataannotation-assessment`](../take-dataannotation-assessment/README.md) |

## Inputs the operator must give

Before starting (session chat or flags):

1. **Resume** file (PDF/DOCX/TXT) — or paste path in the Cursor chat.
2. **Full name** (First + Last) and **email**.
3. **Password policy** on the password page: agent **must ask** — operator types on the host
   themselves, **or** sends the password in session chat for secret typing. Never invent a
   password in the full workflow unless they explicitly say “random password”.

## Mission shape (copy into `mission plan`)

```json
{
  "goal": "DA full workflow for <Full Name>",
  "milestones": [
    { "t": "1 Create account", "done": "confirm_email or signed-in onboarding" },
    { "t": "2 Setup profile", "done": "Availability done; left learn-about-you / ready for projects" },
    { "t": "3 Pick assessment", "done": "Chosen role card opened / assessment started for best match" },
    { "t": "4 Real assessment", "done": "bank full + profile answer.md filled/rechecked; operator reviewed; Submit only on yes" }
  ]
}
```

Run **one big-step skill at a time**. Achieve with a cropped look before moving on.

## Step 1 — Create account (summary)

1. Parse First / Last from full name; use given email.
2. Fill name + email → Continue.
3. On **password page**: `chat` ask + `chat_wait` —
   - “Send the password in chat (I type it secret), or reply `I'll type it` and fill both boxes yourself.”
   - If they send text → fill Create + Confirm with `secret:1` auto-type.
   - If they type themselves → wait until both boxes show green checks, then continue.
4. Terms → agent solves reCAPTCHA by default → Create an account.
5. After confirm email / sign-in, continue to step 2.

Details: `skills/create-dataannotation-account/README.md`.

## Step 2 — Setup profile (summary)

URL: `https://app.dataannotation.tech/workers/learn-about-you`

1. **Welcome** → click **Let's go**.
2. **Resume & LinkedIn** — copy operator resume into the host **Documents** folder; upload that
   file; wait for platform auto-fill; verify other fields.
3. **Experience** / **Education** — usually auto-filled; only fix gaps.
4. **About you** — defaults (unless operator overrides):
   - Academic / Professional background: leave auto-fill
   - English Fluency: **Native**
   - Other languages: from resume (often **Spanish**)
   - Location: **United States**
   - Racial/ethnic background: **White**
   - How did you find us?: **Referral**
   - Any other comments?: **none** / leave blank
5. **Availability**: **40+ hours** always.
6. Continue until profile setup is complete.

Details: `skills/setup-dataannotation-profile/README.md`.

## Step 3 — Choose assessment (summary)

URL: `https://app.dataannotation.tech/workers/projects` (Browse roles).

1. Load catalog: `skills/dataannotation-assessment-workflow/assessments.json`.
2. Score resume → top role + assessment family:
   `node skills/dataannotation-assessment-workflow/pick-assessment.js --resume <file>`
3. Search / filter on the page; open the chosen role card; start that assessment.
4. Do **not** start unrelated roles.

Details: `skills/pick-dataannotation-assessment/README.md`.

## Step 4 — Real assessment (summary)

**Part A — Fetch**

1. **Verbatim** capture into `skills/take-dataannotation-assessment/problems/problems-{role-slug}.md`
   (103 roles): Bio page 1 + Bio page 2 (skip only No-LLMs) + after Start assessment every step,
   including answer-variant cases and scrolled content. **Never Submit** while fetching.
2. **Every main-pane card** on a leaf — not only scored Qs. Mandatory: Section 1 intro
   (“Why general questions?” + “reviewed by a person”), Conversation recap, exclusive-option
   notes. Paraphrase = bug (2026-11-08 Finance miss). See
   [`FETCH-GOTCHAS.md`](../take-dataannotation-assessment/FETCH-GOTCHAS.md) §0.
3. **Parallel without asking** (operator 2026-11-09): if a leaf stem-matches a
   **`captureStatus: verified`** bank, copy that bank’s body (see
   [`ASSESSMENT-TRACK-DIFF.md`](../take-dataannotation-assessment/problems/ASSESSMENT-TRACK-DIFF.md)
   § Parallel reuse). **Always re-fetch live:** “Tell us about the most meaningful…” for every
   role; Section 2 domain/Goal/Haiku; Experience/Degrees; bios. Do not parallel from nearly-full.
4. Re-catch → `.capture.md` → `compare-problems.js --slug …` → update if the **exact** text drifted.
   Mark `captureStatus: full` only when reconcile + bios are complete.

**Part B — Answer** (last step)

```bash
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
```

Follow `session.json` → [`PREFLIGHT.md`](../take-dataannotation-assessment/PREFLIGHT.md) → live runbook [`WORKFLOW-LIVE.md`](../take-dataannotation-assessment/WORKFLOW-LIVE.md) → [`ANSWER.md`](../take-dataannotation-assessment/ANSWER.md).

Live order: TIMER → Claude identity ([`CLAUDE-SETUP.md`](../take-dataannotation-assessment/CLAUDE-SETUP.md)) → Round 1/2 + Share → DA Fields tape fill ([`PART-B-FILL.md`](../take-dataannotation-assessment/PART-B-FILL.md)) → **one** recheck → operator yes. Autofill from `answer.playbook.json` only. **Never Submit** until operator yes. **Never `xdotool type`** — SM `keys` only.

Details: `skills/take-dataannotation-assessment/README.md` + `WORKFLOW-LIVE.md` + `ANSWER.md` + `PREFLIGHT.md`.

## Pitfalls

- Full workflow ≠ random signup drill — use real resume + name + email.
- Never skip the password ask on step 1.
- Resume must live on the **remote** host Documents before the upload picker can see it
  (`files` or `send` / shell copy — request access if needed).
- Role pick must use `assessments.json` + resume scoring, not a gut click on the first card.
- Never skip problem capture / re-catch on step 4; never paste No-LLMs boilerplate into the bank.
- Never skip **non-question UI cards** (Section 1 intro, review notices, recap blocks) — bank verbatim; one-line paraphrase is a fetch fail.
- Before machine resume on step 4: run `prepare-answer.js --strict-full` and read `PREFLIGHT.md` + `WORKFLOW-LIVE.md`.
- PDF resumes must be extracted (not binary-scored). OCR `clickText` is unreliable on some hosts.
- Part B fill: **Backspace** to clear fields (never Ctrl+A); letter-prove before `keys`; SM `keys` only (never machine type); humanize via relay `/api/humanize` + `SM_JOIN_KEY`; never Submit until operator says Submit. See `WORKFLOW-LIVE.md` / `PART-B-FILL.md` (99588 full night).
- Part B **ScreenMirror timer MUST**: immediately after **Start assessment**, arm `status`/`mission` tree; on every leaf `status.step` + append `{profile}/answer.timer.json`. See [`TIMER.md`](../take-dataannotation-assessment/TIMER.md).

## Evidence

Configured 2026-11-07 from operator workflow spec + Welcome / Browse roles screenshots
(`learn-about-you`, `workers/projects`). Step 4 skeleton from Physician/Medical bio + requirements
+ instructions example. Step 1 proven on host 34123. Step 4 Part B upgraded 2026-11-08 feel-test +
2026-11-08/09 full night fill on **99588 / Daniel Herman** (Claude gate, share URL, Fields tape,
WORKFLOW-LIVE).
