---
name: Setup DataAnnotation profile
when: DataAnnotation learn-about-you / Set up your profile — Welcome, Resume & LinkedIn, Experience, Education, About you, Availability after email confirm
tags: browser, forms, dataannotation, profile, resume, onboarding, firefox, mission
run: node kit.js skills setup-dataannotation-profile
---
# skill: setup DataAnnotation profile

Completes **big step 2** of the [assessment workflow](../dataannotation-assessment-workflow/README.md)
on `https://app.dataannotation.tech/workers/learn-about-you` (sidebar: Welcome → Availability).

**Skip** if Availability already done / Browse roles is reachable → hand off to pick-assessment.

## Inputs

- Operator **Full name + Email** already confirmed (workflow MUST).
- Operator **resume** (profile dir or path in Cursor chat).
- Copy it onto the **connected host** under Documents before the upload dialog, e.g.
  `~/Documents/DA-Resume-<Last>.pdf` (Linux) or `Documents\DA-Resume-<Last>.pdf` (Windows).
  Request `files` / `shell` via `access` if the visit lacks them.

## Defaults (About you) — override only if operator says otherwise

| Field | Value |
|-------|--------|
| Academic / Professional background | leave platform auto-fill from resume |
| English Fluency | **Native** |
| Other languages | from resume (most cases **Spanish**; none if resume has none) |
| Currently located | **United States** |
| Racial and ethnic background | **White** |
| How did you find us? | **Referral** |
| Any other comments? | **none** (or leave empty) |
| Availability | **40+ hours** always |

## Mission milestones

| Milestone | Done when |
|-----------|-----------|
| Welcome | clicked **Let's go**; Resume & LinkedIn step visible |
| Resume uploaded | resume file chosen from Documents; platform auto-fill finished |
| Experience / Education | reviewed; auto-fill kept or small gaps fixed |
| About you | defaults applied; look shows Native + US + Referral etc. |
| Availability | **40+ hours** selected |
| Profile complete | left learn-about-you / Continue into projects or “profile done” cue |

## Steps

1. **Welcome** — look for “Welcome to DataAnnotation”; click **Let's go**.
2. **Save resume on host** — `send` / copy operator resume → Documents. Chat the remote path.
3. **Resume & LinkedIn** — open the resume upload control; pick the Documents file; **wait** for
   auto-fill (spinner / fields populate). Do not rush Continue. Check LinkedIn only if operator
   provided a URL.
4. **Experience** — review auto-filled jobs; fix only clear misses from the resume.
5. **Education** — same as Experience.
6. **About you** — apply the defaults table; languages from resume text (Spanish if listed).
7. **Availability** — select **40+ hours** (not a lower tier).
8. Continue / finish until the sidebar locks clear or the Browse roles / projects page appears.
9. Crop a proof look → `mission achieve` → hand off to pick-assessment.

## Pitfalls

- Upload from the **remote** Documents path — a file only on the agent Windows box is invisible
  to the host file picker.
- Auto-fill needs a settle look; clicking Continue too early wipes or skips fields.
- Do not change racial/location/referral defaults unless the operator overrides in chat.
- Cookie banners can steal clicks — Escape or dismiss before sidebar clicks.

## Evidence

Configured 2026-11-07 from Welcome screenshot (`learn-about-you`, user banner “email confirmed”).
Live pass pending.
