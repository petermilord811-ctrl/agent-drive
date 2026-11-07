---
name: Take DataAnnotation assessment
when: DataAnnotation real assessment after role pick — verbatim capture of both bio pages plus all assessment steps/questions/answer-variants into skills/.../problems/problems-{role-slug}.md (103 roles); re-catch/diff; then answer
tags: browser, dataannotation, assessment, problems, markdown, firefox, mission
run: node skills/take-dataannotation-assessment/compare-problems.js --slug software-engineer
---
# skill: take DataAnnotation assessment

**Big step 4** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

## Problem bank

```text
skills/take-dataannotation-assessment/problems/problems-{role-slug}.md
```

103 role files (= Browse **All (103)**). Never use workspace-root `DA assessments/problems-*.md`.

| Tool | Path |
|------|------|
| Index | `problems/README.md`, `problems/index.json` |
| Template | [`problems.template.md`](./problems.template.md) |
| Clicks | [`CLICK.md`](./CLICK.md), `locate-click.py` |
| Diff | `compare-problems.js --slug <role-slug>` |

## HARD RULES (operator 2026-11-07)

### 1. Verbatim only — never summarize

- Copy **exact on-screen text** (prompts, bullets, code, choices, labels).
- **Do not** paraphrase, shorten, or “clean up” wording.
- Summaries make later re-catch diffs false-positive “changed problem”.
- If a block is too long for one look: **scroll** the content pane and append until complete; attach a cropped `.png` under `problems/assets/{slug}/` when text still can’t be recovered cleanly.

### 2. Two bio pages (both required)

| Page | UI cue | Save as |
|------|--------|---------|
| **Bio 1** | Role overview (`← All roles`, Overview / What you’ll do / What we look for / Common backgrounds + right rail pay) | `## Bio` (page 1) |
| **Bio 2** | After **Continue** — title + “{Track} assessment”, pay strip, **What it takes**, **What happens next**, **Start assessment** | `## Bio (assessment intro)` / Requirements from this page |

On Bio 2: save **all** bullets **except** any **No LLMs** / anti-AI line (omit that line only; keep neighbors).

### 3. Full assessment after **Start assessment**

- Enter work mode → sidebar shows steps (e.g. Step 2 of 11, Parts, Questions).
- **Loop every step** in the left nav (Instructions → every Question → coding exercise → Tell us about yourself, etc.).
- Prefer sidebar clicks or **Next**; never **Submit**.

### 4. Answer-dependent layouts

- If choosing a different radio/checkbox/option **changes** the page (new follow-ups, different panels):
  1. For each option: select it → settle look → scroll → capture **verbatim**.
  2. Save under structured cases, e.g. `### Case: Solution A selected`, `### Case: Response B`, etc.
- Capture the **default/empty** state too when it differs.

### 5. Scroll + images

- Code columns and long responses are often clipped — scroll **inside the problem pane** (not only the page) until the bottom of each column/block is visible; stitch text in order.
- When OCR/vision can’t recover code reliably, save `problems/assets/{slug}/q{N}-….png` and link it from the MD.

### 6. Never Submit while fetching

- Fetch/capture runs stop before the final **Submit**. Leave answers unsubmitted or back out after the last step is copied.

## Capture sequence (full bank fill)

1. Open role card → **Bio 1** verbatim → save.
2. **Continue** (`locate-click.py continue`) → **Bio 2** verbatim (skip No-LLMs line) → save.
3. Operator-aware: **Start assessment** begins the one-attempt clock — for **problem-bank fetch** this is required; chat that you’re entering fetch mode and will **not Submit**.
4. Walk sidebar / Next through **all** steps; for each question apply answer-variant + scroll rules.
5. Write `problems-{slug}.md`; on repeats use `.capture.md` + `compare-problems.js`.
6. Mark frontmatter `captureStatus: full` when Bio1+Bio2+all steps done; `bio-only` is incomplete.

## Answering (after bank is `full`)

Separate from fetch. Use the bank; Submit only when actually taking the assessment for real.

## Evidence / debt

- Earlier bio-loop files (SE, Generalist, Data Scientist) were **summarized / Bio-1-only** — **invalid for diff**; must re-capture verbatim + Bio 2 + full questions.
- Click fix: Continue mid `834,312` — see `CLICK.md`.
