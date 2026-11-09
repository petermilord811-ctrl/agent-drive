---
name: DataAnnotation assessment workflow
when: full DataAnnotation.tech worker path — Full name+Email first → create account → setup profile → ALWAYS auto-pick role from resume (unless operator picks manually) → take assessment (bank fetch if needed → answer.md → fill; Never Submit until yes); also when operator says DA workflow, full assessment, onboard, or browse roles after signup
tags: browser, forms, dataannotation, assessment, onboarding, profile, resume, problems, firefox, mission
run: node skills/dataannotation-assessment-workflow/pick-assessment.js --resume path/to/resume.txt
---
# skill: DataAnnotation assessment workflow

Orchestrates the **four big platform steps** on DataAnnotation.tech.

## MUST (always — every big step)

1. **Full name + Email first** — required before connect/signup/fill. Missing → ask once → wait. Never invent.
2. **Always auto-pick role from resume** until the operator says they will pick manually (e.g. “I will pick assessment manually”). Never ask “which assessment?” by default.
3. **Complete bank first** — if `problems-{slug}.md` missing or not `full`/`verified`, Part A fetch that slug before `answer.md` / live fill.
4. **Never Submit until operator explicit yes / Submit** after review. Silence ≠ yes. Applies to fetch and fill.

| Big step | Screen cue | Skill / action | Skip when |
|----------|------------|----------------|-----------|
| **1. Create account** | `worker_signup` | [`create-dataannotation-account`](../create-dataannotation-account/README.md) | Already signed in as this email |
| **2. Setup profile** | `workers/learn-about-you` | [`setup-dataannotation-profile`](../setup-dataannotation-profile/README.md) | Profile/Availability already done → Browse roles |
| **3. Auto-pick role** | `workers/projects` Browse roles | [`pick-dataannotation-assessment`](../pick-dataannotation-assessment/README.md) | Operator said they will pick manually → their role only |
| **4. Real assessment** | role assessment / work mode | [`take-dataannotation-assessment`](../take-dataannotation-assessment/README.md) | — (bank → answer.md → fill; never Submit until yes) |

## Inputs the operator must give

Before starting (session chat or flags):

1. **Host** (ScreenMirror) — operator-named only.
2. **Profile dir** with **Resume** (PDF/DOCX/TXT), or resume path in chat.
3. **Full name** (First + Last) and **email** — **required first** (same identity for DA + Claude).
4. **Password** on the password page: agent **must ask** — operator types on the host, **or** sends in session chat for secret typing. Never invent unless they say “random password”.

## Mission shape (copy into `mission plan`)

```json
{
  "goal": "DA full workflow for <Full Name>",
  "milestones": [
    { "t": "0 Identity", "done": "Full name + Email confirmed" },
    { "t": "1 Create account", "done": "confirm_email or signed-in as that email (or skipped if already in)" },
    { "t": "2 Setup profile", "done": "Availability done / Browse roles ready (or skipped if done)" },
    { "t": "3 Auto-pick role", "done": "session.slug from resume (or manual override); correct role card opened" },
    { "t": "4a Bank", "done": "problems-{slug}.md full|verified" },
    { "t": "4b Answers", "done": "answer.md + answer-gates exit 0 + autofill-ready" },
    { "t": "4c Live fill", "done": "filled+rechecked; Submit only on operator yes" }
  ]
}
```

Run **one big-step skill at a time**. Achieve with a cropped look before moving on.

## Step 1 — Create account (summary)

0. Confirm Full name + Email present (MUST). If already signed in as that email → skip to step 2.
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

0. If already past Availability / on Browse roles → skip to step 3.
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

## Step 3 — Auto-pick role (summary)

URL: `https://app.dataannotation.tech/workers/projects` (Browse roles).

1. **ALWAYS** score resume (unless operator said they will pick manually):
   `node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full`
   or `pick-assessment.js --resume <file>` → use `session.slug` / `pick.role`.
2. Do **not** ask which role. Chat the pick only as status (not a veto prompt).
3. Search Browse roles for that **exact** title; open that card only.
4. Manual override: operator says they will pick → open **their** role; use `--slug` if needed.
5. Do **not** start unrelated roles. Opening the card ≠ Submit; hand off to step 4.

Details: `skills/pick-dataannotation-assessment/README.md`.

## Step 4 — Real assessment (summary)

Follow [`WORKFLOW-LIVE.md`](../take-dataannotation-assessment/WORKFLOW-LIVE.md).

**Part A — Fetch (automatic if bank missing / not full|verified)**

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

**Part B — Answer** (after bank ready)

```bash
# auto-picks slug from resume; omit --slug unless manual pick
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
```

Write `{profile}/answer.md` + gates ([`ANSWER-GATES.md`](../take-dataannotation-assessment/ANSWER-GATES.md)) → `autofill-ready`.

Live order: TIMER → Claude identity with **operator name/email** ([`CLAUDE-SETUP.md`](../take-dataannotation-assessment/CLAUDE-SETUP.md)) → Round 1/2 + Share → DA Fields tape ([`PART-B-FILL.md`](../take-dataannotation-assessment/PART-B-FILL.md)) → **one** recheck → **MUST wait for explicit yes** before Submit. Autofill from `answer.playbook.json` only. **Never `xdotool type`** — SM `keys` only.

Details: `skills/take-dataannotation-assessment/README.md` + `WORKFLOW-LIVE.md` + `ANSWER.md` + `PREFLIGHT.md`.

## Pitfalls

- Full workflow ≠ random signup drill — need host + profile/resume + **Full name + Email first**.
- Never skip the password ask on step 1.
- Resume must live on the **remote** host Documents before the upload picker can see it
  (`files` or `send` / shell copy — request access if needed).
- Role = resume auto-pick (or manual only when operator says so) — never gut-click the first Browse card.
- Never skip problem capture when bank incomplete; never paste No-LLMs boilerplate into the bank.
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
