---
name: Take DataAnnotation assessment
when: DataAnnotation real assessment after role pick — capture bio/requirements/instructions/all questions into skills/.../problems/problems-{type}.md, re-catch and diff if the bank exists, then answer the assessment yourself
tags: browser, dataannotation, assessment, problems, markdown, firefox, mission
run: node skills/take-dataannotation-assessment/compare-problems.js --slug medical
---
# skill: take DataAnnotation assessment

**Big step 4** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

After the role is chosen on Browse roles, the agent **runs the assessment**: first **save every
screened problem** into this skill’s problem bank, then **answer** on its own.

## Problem bank (agent-drive owned)

**Only** this folder — ignore workspace-root `DA assessments/problems-*.md`:

```text
skills/take-dataannotation-assessment/problems/problems-{slug}.md
```

| Piece | Path |
|-------|------|
| Index | [`problems/README.md`](./problems/README.md) + `problems/index.json` |
| Slug map | [`problems-slugs.json`](./problems-slugs.json) |
| Template | [`problems.template.md`](./problems.template.md) |
| Init stubs | `node skills/take-dataannotation-assessment/init-problems-db.js` |
| Diff | `node skills/take-dataannotation-assessment/compare-problems.js --slug <slug>` |

| Assessment family (catalog id) | File |
|--------------------------------|------|
| generalist | `problems/problems-generalist.md` |
| coding | `problems/problems-coding.md` |
| data-ml | `problems/problems-data-ml.md` |
| cybersecurity | `problems/problems-cybersecurity.md` |
| finance | `problems/problems-finance.md` |
| accounting | `problems/problems-accounting.md` |
| economics | `problems/problems-economics.md` |
| legal | `problems/problems-legal.md` |
| medical | `problems/problems-medical.md` |
| healthcare-ops | `problems/problems-healthcare-ops.md` |
| engineering-mechanical | `problems/problems-engineering-mechanical.md` |
| engineering-civil | `problems/problems-engineering-civil.md` |
| engineering-electrical | `problems/problems-engineering-electrical.md` |
| stem (+ biology/chemistry/physics/math) | `problems/problems-stem.md` etc. |
| languages | `problems/problems-languages.md` |
| design | `problems/problems-design.md` |
| project-based | `problems/problems-project-based.md` |

## What to capture (every assessment)

Walk the UI in order. Usually **10+ steps**. Copy text **as shown**.

### 1. Bio — 2. Requirements — 3. Instructions — 4. Questions

Same structure as [`problems.template.md`](./problems.template.md).

- **Requirements:** pay + time only. **Always skip** “No LLMs” / anti-AI boilerplate.
- **Questions:** every step, including Response A/B/C bodies in full.

## Capture workflow (first time)

1. Open the chosen role → start assessment / work mode.
2. Transcribe into  
   `skills/take-dataannotation-assessment/problems/problems-{slug}.capture.md`  
   (or overwrite the stub `problems-{slug}.md` as you go).
3. Cover Bio → Requirements → Instructions → every question until the end of the form.
4. Promote capture → `problems-{slug}.md`; refresh index:  
   `node skills/take-dataannotation-assessment/init-problems-db.js`
5. Chat TOC (question count + path under `skills/.../problems/`).

## Re-catch workflow (bank already captured)

1. Capture again → `problems-{slug}.capture.md`.
2. Compare (paths default into this skill’s `problems/`):

```bash
node skills/take-dataannotation-assessment/compare-problems.js --slug medical
```

3. If `changed: true` → replace `problems-{slug}.md` from the capture; chat what drifted.
4. If unchanged → drop the capture; answer using the bank.

**Always re-catch** on a repeat of the same assessment type.

## Answering (after bank is current)

1. Answer every live step; fact-check when asked.
2. Keep long free-text locally if the UI warns about cache loss.
3. Submit → prove with a look → mission achieve.

## Mission milestones

| Milestone | Done when |
|-----------|-----------|
| Assessment open | role assessment / work-mode UI visible |
| Bank captured | `skills/.../problems/problems-{slug}.md` has Bio/Requirements/Instructions/Questions |
| Bank verified | first capture or re-catch compared |
| Assessment submitted | submit confirmation on screen |

## Pitfalls

- Do **not** read/write workspace-root `DA assessments/problems-*.md` for this skill.
- Skipping Bio/Requirements; pasting No-LLMs text; wrong slug; answering before re-catch;
  truncating Response A/B.

## Evidence

Bank relocated into the skill 2026-11-07 (21 stubs via `init-problems-db.js`). Live fill pending.
