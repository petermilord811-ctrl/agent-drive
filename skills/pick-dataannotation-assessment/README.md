---
name: Pick DataAnnotation assessment
when: DataAnnotation Browse roles / workers/projects Assessment step — choose the best role from resume after profile setup
tags: browser, dataannotation, assessment, roles, resume, firefox, mission
run: node skills/dataannotation-assessment-workflow/pick-assessment.js --resume path/to/resume.txt
---
# skill: pick DataAnnotation assessment

Completes **big step 3** of the [assessment workflow](../dataannotation-assessment-workflow/README.md)
on `https://app.dataannotation.tech/workers/projects` (“Get paid to teach AI your expertise” /
Browse roles). Progress bar: Account ✓ → **Assessment** current.

## Catalog (database)

Canonical list (families + roles + keywords):

`skills/dataannotation-assessment-workflow/assessments.json`

Re-run scoring after catalog edits:

```bash
# Prefer plain-text extract of the resume
node skills/dataannotation-assessment-workflow/pick-assessment.js --resume ./work/resume.txt --top 5
```

Output JSON: `pick.role`, `pick.assessment`, `pick.category`, `alternatives[]`.

## Mission milestones

| Milestone | Done when |
|-----------|-----------|
| Catalog scored | pick-assessment.js printed a top role for this resume |
| Roles page open | Browse roles grid visible (All / category pills) |
| Role selected | search or filter → correct role card focused / opened |
| Assessment entered | left the browse grid into that role’s assessment start |

## Steps

1. Ensure a text extract of the resume exists in the visit folder (or operator path).
2. Run `pick-assessment.js`; `chat` the pick + top alternatives; proceed unless operator vetoes.
3. On Browse roles: use search box (“Search roles by title…”) with the **exact role title**.
4. Open that card; confirm category matches `pick.category`.
5. Start / continue into the assessment UI.
6. Crop proof → achieve → hand off to [`take-dataannotation-assessment`](../take-dataannotation-assessment/README.md)
   (capture/re-catch `skills/.../problems/problems-{slug}.md`, then answer).

## Matching rules

- Highest keyword + role-title score wins.
- Tie / weak score → prefer **Generalist** only if nothing else scores; otherwise ask the operator
  among the top 3 alternatives.
- Project-Based Specialist roles only when the resume clearly matches that niche.
- Never start multiple assessments in one visit unless asked.

## Pitfalls

- First visible cards (Software Engineer, Generalist, …) are not automatic picks.
- Category pill alone is not enough — open the **role** the scorer named.
- Keep `assessments.json` updated when the platform adds roles (operator list is source of truth).

## Evidence

Configured 2026-11-07 from Browse roles screenshot (`workers/projects`, 103 roles / category pills).
Live pick pending first resume pass.
