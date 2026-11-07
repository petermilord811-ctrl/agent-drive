---
name: Take DataAnnotation assessment
when: DataAnnotation real assessment after role pick — capture bio/requirements/instructions/all questions into skills/.../problems/problems-{role-slug}.md (103 roles), re-catch and diff if the bank exists, then answer; also bio loop overviews
tags: browser, dataannotation, assessment, problems, markdown, firefox, mission
run: node skills/take-dataannotation-assessment/compare-problems.js --slug software-engineer
---
# skill: take DataAnnotation assessment

**Big step 4** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

## Problem bank (agent-drive owned)

```text
skills/take-dataannotation-assessment/problems/problems-{role-slug}.md
```

- **103 files** = Browse roles **All (103)** (one per role card, not per family).
- Ignore workspace-root `DA assessments/problems-*.md`.
- Index: [`problems/README.md`](./problems/README.md) + `problems/index.json`
- Init: `node skills/take-dataannotation-assessment/init-problems-db.js`
- Diff: `node skills/take-dataannotation-assessment/compare-problems.js --slug <role-slug>`
- **Clicks:** [`CLICK.md`](./CLICK.md) + `locate-click.py` — never guess coords.

Examples: `problems-software-engineer.md`, `problems-generalist.md`, `problems-physician.md`.

## What to capture

| Mode | Save | Do not |
|------|------|--------|
| **Bio loop** | Overview Bio + sidebar Requirements (pay/remote/…) | Continue into questions / **Start assessment** |
| **Full** | Bio → Requirements → Instructions → all Questions (10+) | Paste No-LLMs boilerplate |

Overview sidebar pay beats the Browse grid when they disagree.

## Capture / re-catch

1. Fresh `look` → open role (search → click **card body**).
2. Transcribe into `problems-{slug}.md` (or `.capture.md` then compare).
3. Re-catch on repeats: `compare-problems.js --slug …` → update if changed.
4. Full answer path only after operator OK (Start = **one attempt**).

## Evidence

- 34123, 2026-11-07: Continue miss (~60px low) → `locate-click.py`; SE intro opened.
- Bio loop started: Software Engineer, Generalist, Data Scientist overviews saved (3/103).
