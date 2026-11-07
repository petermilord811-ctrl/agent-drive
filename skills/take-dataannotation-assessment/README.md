---
name: Take DataAnnotation assessment
when: DataAnnotation real assessment after role pick — capture bio/requirements/instructions/all questions into problems-{type}.md, re-catch and diff if the bank exists, then answer the assessment yourself
tags: browser, dataannotation, assessment, problems, markdown, firefox, mission
run: node skills/take-dataannotation-assessment/compare-problems.js --slug medical --new path/to/capture.md --existing ../../problems-medical.md
---
# skill: take DataAnnotation assessment

**Big step 4** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

After the role is chosen on Browse roles, the agent **runs the assessment**: first **save every
screened problem** into a professional markdown bank, then **answer** the assessment on its own.
Step-by-step answering tactics per domain can deepen later; the skeleton below is required every time.

## Problem bank path + naming

Workspace root (sibling of `agent-drive/`):

```text
../problems-{slug}.md
```

Examples already in the workspace: `problems-medical.md`, `problems-accounting.md`,
`problems-biology.md`, `problems-program.md`, …

| Assessment family (catalog id) | File slug |
|--------------------------------|-----------|
| generalist | `generalist` |
| coding | `program` |
| data-ml | `datascience` |
| cybersecurity | `cybersecurity` |
| finance | `finance` |
| accounting | `accounting` |
| economics | `economics` |
| legal | `legal` |
| medical | `medical` |
| healthcare-ops | `healthcare-ops` |
| engineering-mechanical | `mechnical` |
| engineering-civil | `civil` |
| engineering-electrical | `electrical` |
| stem | use role hint → `biology` / `chemistry` / … |
| languages | `languages` |
| design | `design` |
| project-based | `projects` |

Slug map (machine): `skills/take-dataannotation-assessment/problems-slugs.json`  
Template: `skills/take-dataannotation-assessment/problems.template.md`

## What to capture (every assessment)

Walk the UI in order. Usually **10+ steps**. Copy text **as shown** (prompts, choices, Response A/B/C,
rubrics). Professional markdown — headings, lists, code fences when the form shows code.

### 1. Bio (role overview card)

Before or at assessment start — role title, category, hiring cue, Overview, What you’ll actually do,
What we look for, Common backgrounds. Example shape (Physician / Medical):

```markdown
## Bio

**Role:** Physician  
**Category:** Medical  
**Hiring cue:** 63 hired recently

### Overview
…

### What you’ll actually do
- …

### What we look for
- …

### Common backgrounds
- Physician
- Clinician
```

### 2. Requirements

Save pay and time only. **Always skip** “No LLMs” / “answers should be your own” / anti-AI
boilerplate — do not paste that block into the bank.

```markdown
## Requirements

- **Pay:** Up to $125+/hr (as shown)
- **Typical completion:** People who pass usually spend 1 hour 30 minutes or more. Take the time you need.
- **Task window:** (e.g. available 120 hours after entering work mode — copy the number from the page)
```

### 3. Instructions

Full welcome / how-long / break guidance **except** the No-LLMs paragraph(s). Keep useful timing and
caching warnings.

### 4. All problems / steps

Every question, sub-question (`1a`, `1B`, …), professional-experience prompts, MC options, model
responses, and explanation prompts — normally more than 10 steps. Use:

```markdown
## Questions

## Question 1
…
## Question 1a
…
```

Match the style of existing banks (`problems-biology.md`, `problems-accounting.md`).

## Capture workflow (first time)

1. Open the chosen role → start assessment / work mode.
2. For each screen: `look` → transcribe into a draft
   `../problems-{slug}.capture.md` (or write sections into the final file as you go).
3. Cover Bio → Requirements → Instructions → every question until Submit / end.
4. Rename / save as `../problems-{slug}.md`.
5. Chat a short TOC (question count + slug path).

## Re-catch workflow (bank already exists)

If `../problems-{slug}.md` already exists:

1. Run the **same capture** into `../problems-{slug}.capture.md` (do not answer yet).
2. Compare:

```bash
node skills/take-dataannotation-assessment/compare-problems.js \
  --slug medical \
  --existing ../problems-medical.md \
  --new ../problems-medical.capture.md
```

3. If `changed: true` → replace/update the bank (keep a `.prev.md` only if the operator asks), chat
   what drifted (bio / requirements / which question numbers).
4. If unchanged → delete/ignore the capture; proceed to answer using the existing bank.

**Always re-catch** on a repeat assessment of the same type — never assume the bank is still current.

## Answering (after bank is current)

1. Work through each step on the live form.
2. Use domain expertise + the saved problem text; fact-check claims when the question asks.
3. Do not skip questions. Prefer thoughtful, complete answers over speed.
4. Keep a local copy of long free-text answers in the visit folder if the UI warns about cache loss.
5. Submit when complete; look for pass / pending-review cue → mission achieve.

(Domain-specific answer playbooks can be added later under this skill; capturing + comparing is
mandatory first.)

## Mission milestones

| Milestone | Done when |
|-----------|-----------|
| Assessment open | role assessment / work-mode UI visible |
| Bank captured | `problems-{slug}.md` has Bio, Requirements, Instructions, all questions |
| Bank verified | first run saved, or re-catch compared (updated if changed) |
| Assessment submitted | submit confirmation / left work mode with answers in |

## Pitfalls

- Skipping Bio/Requirements and only dumping Question 1… loses the bank’s purpose.
- Pasting **No LLMs** text into the MD — always omit.
- Wrong slug (`medical` vs `physician`) — use family slug from `problems-slugs.json`, not the role
  title alone (Physician → `medical`).
- Answering before re-catch on a repeat run — problems may have changed.
- Truncating long Response A/B bodies — copy in full; the bank is the source of truth.

## Evidence

Skeleton configured 2026-11-07 from operator workflow (Physician/Medical bio + requirements +
instructions example). Live capture/compare pass pending.
