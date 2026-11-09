---
name: Pick DataAnnotation assessment
when: DataAnnotation Browse roles / workers/projects Assessment step — ALWAYS auto-pick best role from resume after profile setup unless operator says they will pick manually
tags: browser, dataannotation, assessment, roles, resume, firefox, mission
run: node skills/dataannotation-assessment-workflow/pick-assessment.js --resume path/to/resume.txt
---
# skill: pick DataAnnotation assessment

Completes **big step 3** of the [assessment workflow](../dataannotation-assessment-workflow/README.md)
on `https://app.dataannotation.tech/workers/projects` (“Get paid to teach AI your expertise” /
Browse roles). Progress bar: Account ✓ → **Assessment** current.

## MUST

1. **ALWAYS auto-pick from resume** via `pick-assessment.js` / `prepare-answer.js --profile` (no `--slug`).
2. **Do not ask** “which assessment?” Override **only** when the operator says they will pick manually (then open their role / `--slug`).
3. Chat the pick as **status**, not a veto prompt.
4. Opening the role card ≠ Submit. Hand off to take-assessment (bank → answers → fill).

## Catalog (database)

Canonical list (families + roles + keywords):

`skills/dataannotation-assessment-workflow/assessments.json`

```bash
# PDF/DOCX are extracted (never read as binary). TXT/MD also fine.
node skills/dataannotation-assessment-workflow/pick-assessment.js --resume "path/Resume.pdf" --top 5
# Or (preferred with a profile folder — also gates the bank):
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
```

Output JSON: `pick.role`, `pick.assessment`, `pick.category`, `alternatives[]`, `extracted`  
(or `session.slug` / `session.role` from prepare-answer).

**HARD (99588 / Daniel Herman):** Do not `fs.readFileSync` a PDF as utf8 — short tokens like `ui` false-hit Designer. Script uses `extract-resume-text.py` + whole-token keyword match (`chemist` must not match `biochemistry`).

## Mission milestones

| Milestone | Done when |
|-----------|-----------|
| Catalog scored | pick / session.slug set from resume (or manual override) |
| Roles page open | Browse roles grid visible (All / category pills) |
| Role selected | search → **that** role card opened |
| Hand-off | take-assessment owns bank/answers/fill for that slug |

## Steps

1. Ensure resume path (profile folder or operator path).
2. Run pick / prepare-answer **without** `--slug` unless manual pick.
3. Optionally `chat` “Picked {role} ({slug}) from resume” — then continue (no wait for veto).
4. On Browse roles: search (“Search roles by title…”) with the **exact** role title.
5. Open that card; confirm category matches pick. Do not open a different card.
6. Hand off to [`take-dataannotation-assessment`](../take-dataannotation-assessment/README.md)
   (if bank missing/incomplete → fetch first; then `answer.md`; live fill; Never Submit until yes).

## Matching rules

- Highest keyword + role-title score wins → **take it**.
- Tie / weak score → prefer **Generalist** only if nothing else scores; otherwise take the **top** alternative (still no ask). Ask only if pick **fails** (no extract / script error) or operator already said manual.
- Project-Based Specialist roles only when the resume clearly matches that niche.
- Never start multiple assessments in one visit unless asked.

## Pitfalls

- First visible cards (Software Engineer, Generalist, …) are not automatic picks — use scorer output.
- Category pill alone is not enough — open the **role** the scorer named.
- Keep `assessments.json` updated when the platform adds roles (operator list is source of truth).
- On 99588, OCR `clickText` often sees only chrome — use `locate-click.py <look> role "Data Scientist"` (dbl). Gray titles need `CARD_TITLE_DARK`; never heuristic-click col2 without a measure (opened SE by mistake).
- “Chat pick and wait for veto” is **forbidden** under always-auto-pick.

## Evidence

Configured 2026-11-07 from Browse roles screenshot (`workers/projects`, 103 roles / category pills).
Auto-pick HARD aligned 2026-11-09 with take-assessment PREFLIGHT / WORKFLOW-LIVE.
