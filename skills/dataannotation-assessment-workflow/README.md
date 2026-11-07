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
    { "t": "4 Real assessment", "done": "skills/.../problems/problems-{slug}.md current; assessment submitted" }
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

1. **Capture** Bio → Requirements (pay/time; **skip No-LLMs text**) → Instructions → all
   questions into `skills/take-dataannotation-assessment/problems/problems-{slug}.md`
   (agent-drive bank only — not workspace-root `DA assessments/problems-*.md`).
2. If already captured: re-catch → `.capture.md` → `compare-problems.js --slug …` → update if needed.
3. **Answer** the live assessment; submit; prove with a look.

Details: `skills/take-dataannotation-assessment/` (`init-problems-db.js`, `problems/README.md`).

## Pitfalls

- Full workflow ≠ random signup drill — use real resume + name + email.
- Never skip the password ask on step 1.
- Resume must live on the **remote** host Documents before the upload picker can see it
  (`files` or `send` / shell copy — request access if needed).
- Role pick must use `assessments.json` + resume scoring, not a gut click on the first card.
- Never skip problem capture / re-catch on step 4; never paste No-LLMs boilerplate into the bank.

## Evidence

Configured 2026-11-07 from operator workflow spec + Welcome / Browse roles screenshots
(`learn-about-you`, `workers/projects`). Step 4 skeleton from Physician/Medical bio + requirements
+ instructions example. Step 1 proven on host 34123; steps 2–4 live pass pending.
