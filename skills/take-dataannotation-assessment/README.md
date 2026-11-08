---
name: Take DataAnnotation assessment
when: DataAnnotation real assessment after role pick — Part A verbatim capture into skills/.../problems/problems-{role-slug}.md (103 roles) + re-catch/diff; Part B prepare-answer → answer.md → playbook → paced autofill → operator review before Submit
tags: browser, dataannotation, assessment, problems, answers, autofill, pacing, humanize, markdown, firefox, mission, preflight
run: node skills/take-dataannotation-assessment/prepare-answer.js --profile "path/to/profile" --strict-full
---
# skill: take DataAnnotation assessment

**Big step 4** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

**Before resume on a real machine:** [`PREFLIGHT.md`](./PREFLIGHT.md).

| Part | When | Doc |
|------|------|-----|
| **A. Fetch** | captureStatus not yet `full` | this README (HARD RULES + Capture sequence) |
| **B. Answer** | bank `full` + re-catch clean → real take | [`ANSWER.md`](./ANSWER.md) + [`PREFLIGHT.md`](./PREFLIGHT.md) |

## Problem bank (Part A)

```text
skills/take-dataannotation-assessment/problems/problems-{role-slug}.md
```

103 role files (= Browse **All (103)**). Never use workspace-root `DA assessments/problems-*.md`.

| Tool | Path |
|------|------|
| Index | `problems/README.md`, `problems/index.json` |
| Template | [`problems.template.md`](./problems.template.md) |
| **MD style** | [`problems/STYLE.md`](./problems/STYLE.md) — plain structured Markdown (no HTML) |
| Clicks | [`CLICK.md`](./CLICK.md), `locate-click.py`, `test-locate-click.py` |
| Diff | `compare-problems.js --slug <role-slug>` |
| Reconcile | `reconcile-steps.js --slug … --sidebar-json …` |
| **Answer (B)** | [`ANSWER.md`](./ANSWER.md), [`answers.template.md`](./answers.template.md) |
| Humanize | `humanize-text.py` (balanced) |
| Fill plan | `parse-answer-fill.js` → `{profile}/answer.fill.json` |
| Pace | `pace-plan.js` → `{profile}/answer.pace.json` |
| Validate | `validate-answers.js --slug … --answer …` |
| **Part B gate** | `answer-ready.js --slug … --profile … [--strict-full\|--auto-pick]` |
| **Part B orchestrator** | `prepare-answer.js --profile … [--slug …] [--strict-full]` → `session.json` + playbook |
| **Preflight** | [`PREFLIGHT.md`](./PREFLIGHT.md) |
| **Local OCR (Browse)** | `look-ocr.js <look.png> --find "Data Scientist"` — when host OCR is chrome-blind |

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

- Enter work mode → sidebar shows steps (e.g. Step 1 of 14 Generalist; Step 2 of 11 SE).
- **Loop every step** in the left nav (Instructions → every Question → coding / rubrics → demographics → optional).
- Prefer **sidebar** when Next misses; never **Submit**.
- Omit anti-AI / No-LLM bodies on **Instructions** and **certify** (keep step label + “I agree”).
- **Clicks:** always `locate-click.py` on the *current* look (`zones` / `next` / `radio N` / `role`). Content clicks with `lx ≤ sidebar_edge` are forbidden — see [`CLICK.md`](./CLICK.md).

### 3b. Sidebar inventory vs fetched steps (HARD — operator 2026-11-08)

**Do not trust “I visited most questions.”** Count the sidebar, then reconcile the bank.

1. At fetch start (and again before marking `full`), OCR/list every **leaf** row in the left nav — **not** PART/section headers. Save `problems/assets/{slug}/sidebar-inventory.json` (`total`, `leaves[{step,label}]`).
2. Walk leaves **in sidebar order** (Step 1…N). Opening Coding before Q5 = skip.
3. Each leaf must become one `## …` section with `**Step:** Step k of N` in **ascending** order in the MD.
4. Gate: `node skills/take-dataannotation-assessment/reconcile-steps.js --slug <slug> --sidebar-json problems/assets/<slug>/sidebar-inventory.json`
   - Fails on missing `k`, duplicate `k`, or **outOfOrder** (e.g. SE had Q5 after Coding = “skipped Question 5”).
5. `captureStatus: full` is forbidden while reconcile `ok` is false.

### 4. Answer-dependent layouts

- If choosing a different radio/checkbox/option **changes** the page (new follow-ups, different panels):
  1. For each option: select it → settle look → scroll → capture **verbatim**.
  2. Save under structured cases, e.g. `### Case: Solution A selected`, `### Case: Response B`, etc.
- Capture the **default/empty** state too when it differs.
- Writing fields: `radio N` → **Tab** → type. Do **not** dense-sweep the left third (sidebar).

### 5. Scroll + images + links (HARD — operator bugs 2026-11-07/08)

**A step is NOT captured until the whole problem pane is scrolled end-to-end.**

Top-of-step look alone is invalid when content is taller than the viewport (SE Q2 missed **Explanation**; SE Programming Languages missed options after TypeScript).

For **every** assessment step:

1. Capture the top (prompt / code columns / choices as visible).
2. Scroll **inside the main problem pane** (focus content → **PageDown**; wheel alone often no-ops) — **not** only the browser page / sidebar.
3. Keep scrolling until **all** of these are true (or proven absent):
   - choice radios / checkboxes / drag lists **to the last option** (not just the first viewport)
   - any **Explanation** / “provide your reasoning” / “explain your answer” block
   - empty **textarea** under that prompt
   - footer **Back** + **Next** (or Submit on last step only — do not press Submit)
4. Save `qN.png` (top) + `qN_pd.png` / `qN_bottom.png` (after scroll). Stitch verbatim text in order.
5. Helper: `locate-click.py <look.png> scroll-complete` — refuses `ok` until footer + explanation / list-end cues are in-frame (see [`CLICK.md`](./CLICK.md)).

**Embedded diagrams / example images (not prose):**
- Never replace a figure with a prose paraphrase (e.g. “black box with letter F”).
- Crop the on-screen figure → `problems/assets/{slug}/….png` and **embed** it in the MD with `![…](assets/…)`, **or** redraw it character-for-character (same grid). Prefer the PNG embed.

**URLs / hyperlinks (OCR is untrusted):**
- Do **not** trust OCR for long URLs (Google Docs `/pub` links, etc.).
- **Only** for outside links: click → new tab → **Ctrl+L** → **Ctrl+C** → read clipboard into the bank.
- **Never** `Ctrl+A` / select-all copy of the assessment page to capture problem text (look + scroll + PNGs / transcription instead).
- Optional: keep a `*_link.png` of the address bar as evidence.

### 6. Never Submit while fetching

- Fetch/capture runs stop before the final **Submit** (Generalist Step 14 footer). Leave answers unsubmitted or navigate away via URL after the last step is copied.

## Capture sequence (full bank fill)

1. Open role card → **Bio 1** verbatim → save.
2. **Continue** (`locate-click.py continue`) → **Bio 2** verbatim (skip No-LLMs line) → save.
3. Operator-aware: **Start assessment** begins the one-attempt clock — for **problem-bank fetch** this is required; chat that you’re entering fetch mode and will **not Submit**.
4. Write `sidebar-inventory.json` from left-nav leaves; walk **in that order**.
5. For each leaf: scroll-complete + answer-variants; write `problems-{slug}.md`.
6. `reconcile-steps.js --slug … --sidebar-json …` must exit 0; then `compare-problems.js` on re-catch.
7. Mark `captureStatus: full` only when Bio1+Bio2 + reconcile ok; `bio-only` / `nearly-full` otherwise.

## Part B — Answering (after bank is `full`)

**Full procedure:** [`ANSWER.md`](./ANSWER.md) · **Machine checklist:** [`PREFLIGHT.md`](./PREFLIGHT.md).

```bash
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
# read session.phase / nextSteps — do not invent a path around a blocked bank
```

Then: generate `answer.md` → humanize → parse/validate → re-run `prepare-answer` (emits playbook) → timed autofill from `answer.playbook.json` → recheck → operator **Submit** yes only.

## Evidence / debt (2026-11-07 / 11-08 host 34123)

| Role | `captureStatus` | Debt |
|------|-----------------|------|
| Software Engineer | `nearly-full` | Q5 **pseudocode**; Verify URL fixed; languages fixed |
| Generalist | `nearly-full` | Instructions expanded; Q1 `$246.64`; Q6 verbatim; plain MD structure 2026-11-08 |
| Data Scientist (+101 others) | incomplete / stub | full verbatim Bio1+Bio2+assessment |

- Click stack fixed 2026-11-07: zone-safe `locate-click.py` (sidebar/content split, vertical radio columns, Next footer pick, role refuses col-0 default). See [`CLICK.md`](./CLICK.md).
- **Scroll bug fixed 2026-11-08:** sticky Next can show while **Explanation** is below the fold (SE Q1/Q2). Gate with `locate-click.py <look> scroll-complete`; focus content + **PageDown** until ok; save `qN.png` + `qN_bottom.png`.
- **Part B feel-test 99588 / Daniel Herman (2026-11-08):** pick PDF/binary + `ui`/`Chemist⊂biochemistry` fixed; role gray-title+segment fix; `answer-ready.js` gate. DS bank still incomplete — fetch before answer.
