---
name: Take DataAnnotation assessment
when: DataAnnotation real assessment after auto-pick (or manual) — if bank missing/not full fetch Part A first; then answer.md + gates; playbook autofill; MUST Never Submit until operator yes; Full name+Email required first
tags: browser, dataannotation, assessment, problems, answers, autofill, pacing, humanize, markdown, firefox, mission, preflight
run: node skills/take-dataannotation-assessment/prepare-answer.js --profile "path/to/profile" --strict-full
---
# skill: take DataAnnotation assessment

**Big step 4** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

**Before resume on a real machine:** [`PREFLIGHT.md`](./PREFLIGHT.md).

| Part | When | Doc |
|------|------|-----|
| **A. Fetch** | bank missing or captureStatus not `full`/`verified` — **do this first automatically** | this README (HARD RULES + Capture sequence) |
| **B. Answer** | bank ready → real take | [`ANSWER.md`](./ANSWER.md) + [`PREFLIGHT.md`](./PREFLIGHT.md) |
| **B. Live runbook** | connect → Claude → fill → Submit gate | [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) (**read first** on live host) |
| **B. Fill contract** | every DA `keys` | [`PART-B-FILL.md`](./PART-B-FILL.md) |
| **B. Claude gate** | Section 1 share URL | [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md) |

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
| **Fetch gotchas** | [`FETCH-GOTCHAS.md`](./FETCH-GOTCHAS.md) — DS 2026-11-08 never-again list |
| Clicks | [`CLICK.md`](./CLICK.md), `locate-click.py`, `test-locate-click.py` |
| Diff | `compare-problems.js --slug <role-slug>` |
| Reconcile | `reconcile-steps.js --slug … --sidebar-json …` |
| Verbatim gate | `validate-verbatim.js --slug …` |
| Figure gate | `validate-figures.js --slug …` (no half-hidden chart crops) |
| **Answer (B)** | [`ANSWER.md`](./ANSWER.md), [`answers.template.md`](./answers.template.md) |
| **Answer gates (B)** | [`ANSWER-GATES.md`](./ANSWER-GATES.md) + `answer-gates.py` — MeaningPass ∧ QualityPass ∧ DetectPass required before autofill (Herman never-again) |
| Humanize / AI-check | after MQ on best: one humanize or spoken variant; `aicheck-answer.py` DetectPass only — never `HUMANIZE_API_KEY` / not MCP |
| Fill plan | `parse-answer-fill.js` → `{profile}/answer.fill.json` |
| Pace | `pace-plan.js` → `{profile}/answer.pace.json` |
| Validate | `validate-answers.js --slug … --answer …` |
| **Part B gate** | `answer-ready.js --slug … --profile … [--strict-full\|--auto-pick]` |
| **Part B orchestrator** | `prepare-answer.js --profile … [--strict-full]` → **always** auto-pick role from resume → `session.json` + playbook (`--slug` only after operator says they will pick manually) |
| **Part B timer (MUST)** | [`TIMER.md`](./TIMER.md) — arm `status`/`mission` after Start; log every leaf to `answer.timer.json` |
| **Preflight** | [`PREFLIGHT.md`](./PREFLIGHT.md) |
| **Local OCR (Browse)** | `look-ocr.js <look.png> --find "Data Scientist"` — when host OCR is chrome-blind |

## HARD RULES (operator 2026-11-07)

### 1a. Parallel reuse — autonomous (HARD — operator 2026-11-09)

Do **not** wait for the operator to say “parallel.” On every Part A fetch/recheck:

1. Load `problems/ASSESSMENT-TRACK-DIFF.md` § Parallel reuse + verified source list (`captureStatus: verified` **only**).
2. After Bio + Instructions, for each Section 1 leaf: **stem-match gate** (2+ checks) against verified Generalist / verified Expert Domain sibling.
3. On match → **copy verified bank verbatim** into this slug; stamp `### Parallel: {source} · {date} · stem-matched`. Do not re-OCR long A/B.
4. On mismatch / no verified source → live OCR that leaf only.
5. **Always live-fetch** (never parallel):
   - **Tell us about the most meaningful…** (domain-templated write-in) — **every role**, every track.
     The `{Domain}-related` token changes per assessment (e.g. Radiology / Economics / Data Science /
     Surgical or Perioperative / Internal Medicine / **Medical**). Ellipsis-only stubs (`most meaningful…`) are
     **not done** — bank the full sentence live. Operator 2026-11-10: never assume shared wording.
   - **Section 3: Your Background** intro + experience checklist — also domain-specific
     (e.g. “familiarity with the **Radiology Domain**” / **Medical Domain** / **Internal Medicine Domain**
     + matching checkboxes). Never parallel Section 3 across assessments — Physician ≠ IM ≠ Surgical ≠ Radiology.
     Operator 2026-11-10.
   - Section 2 domain string + Goal example cue + Haiku version
   - Experience / Degrees / credential radios / specialization lists
   - Bios / track line / pay
6. Expert Domain **Q6 London Fog** / **Q7 complex prompt** → parallel from verified **Economist** (not Generalist Fog/Q8).
7. Conversation Yes-branch follow-ups → parallel structure from verified Economist with domain-string swap; still spot-check one distinctive phrase live.

### 1. Verbatim only — never summarize (HARD — operator 2026-11-08; Chemist miss 2026-11-09)

**Also forbidden:** headings/lines like `Summary from live look:`, `Prompt (summary — PNG is source of truth)`, or bullet paraphrases of Response A/B/C. Bank the **full** response prose (or complete OCR text files + PNG). `validate-verbatim.js` fails these markers.

- Copy **exact on-screen text** (prompts, bullets, code, choices, labels, datasets, model responses).
- **Do not** paraphrase, shorten, “clean up”, OCR-repair, or invent missing words.
- **Do not** skip non-question cards (Section 1 “Why general questions?” / “reviewed by a person”, Conversation recap). They are part of the leaf — bank verbatim (`FETCH-GOTCHAS.md` §0).
- **Forbidden in problem body:** square-bracket guesses (`[and]`, `[you will]`), “summary from looks”, ellided datasets, comparative paraphrases of A/B/C.
- If OCR is garbled: **do not invent** — keep the PNG under `problems/assets/{slug}/`, leave that block empty / `*(see asset — verbatim pending)*`, and keep `captureStatus` below `full`.
- If a block is too long for one look: **scroll** the content pane and append until complete; stitch looks in order.
- Gate: `validate-verbatim.js` **and** `validate-figures.js` must both exit 0 before `full` (also run by `answer-ready.js --strict-full`).
- Summaries make later re-catch diffs false-positive “changed problem”. Live miss: DS bank 2026-11-08 filled with vision/OCR repairs — rejected.
- **OCR method:** do **not** select/highlight text for OCR. Use `ocr {rect}` on the live screen, or local `ocr-bands.py` / `upscale-ocr.js` on a look PNG. Host `ocr` may stick on the first Instructions block after scroll — then OCR the **look PNG**, keep the raw dump (`.ocr.txt`), do not rewrite into clean English.
- Bank OCR results as **structured** Prompt / Choices / Write-in (STYLE.md) — never a `Source OCR` dump field. Dirty OCR → re-look/re-OCR; do not invent clean prose.
- **Vision / image_description is not source text.** Confirm `$` rates, model names (Haiku 5.5), and datasets with band-OCR before banking.
- Full never-again list: [`FETCH-GOTCHAS.md`](./FETCH-GOTCHAS.md).

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
2. Walk leaves **in sidebar order** (Step 1…N). Opening Coding before Q5 = skip. **Never skip Section 3: Your Background** to jump Coding/meaningful (ME miss 2026-11-09).
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
- Never replace a figure with a prose paraphrase (e.g. “black box with letter F”, “bars ~95%”).
- Crop the on-screen figure → `problems/assets/{slug}/….png` and **embed** it in the MD with a relative image under that folder, **or** redraw it character-for-character (same grid). Prefer the PNG embed.
- **Figure completeness (HARD — DS 2026-11-08):** title + **both axes** + all tick labels must be in-frame before crop. Half-hidden charts fail `validate-figures.js`. Keep a full-viewport `*-live.png` alongside the crop.

**URLs / hyperlinks (OCR is untrusted):**
- Do **not** trust OCR for long URLs (Google Docs `/pub` links, etc.).
- **Only** for outside links: click → new tab → **Ctrl+L** → **Ctrl+C** → read clipboard into the bank.
- **Never** `Ctrl+A` / select-all copy of the assessment page to capture problem text (look + scroll + PNGs / transcription instead).
- Optional: keep a `*_link.png` of the address bar as evidence.

### 6. MUST — Never Submit until operator yes (always)

- **Every phase** (fetch, fill, recheck, sign-off): never click Submit / “Submit and Begin Next Task” unless the operator explicitly says **yes** / **Submit** after review. Silence ≠ yes.
- Fetch/capture runs stop before the final **Submit**. Leave answers unsubmitted or navigate away after the last step is copied.

## Capture sequence (full bank fill)

1. Open role card → **Bio 1** verbatim → save.
2. **Continue** (`locate-click.py continue`) → **Bio 2** verbatim (skip No-LLMs line) → save.
3. Operator-aware: **Start assessment** begins the one-attempt clock — for **problem-bank fetch** this is required; chat that you’re entering fetch mode and will **not Submit**.
4. Write `sidebar-inventory.json` from left-nav leaves; walk **in that order**.
5. For each leaf: scroll-complete + answer-variants; write `problems-{slug}.md`.
6. `reconcile-steps.js --slug … --sidebar-json …` must exit 0; then `compare-problems.js` on re-catch.
7. Mark `captureStatus: full` only when Bio1+Bio2 + reconcile ok; `bio-only` / `nearly-full` otherwise.

## Part B — Answering (after bank is `full`)

**Full procedure:** [`ANSWER.md`](./ANSWER.md) · **Machine checklist:** [`PREFLIGHT.md`](./PREFLIGHT.md) · **Never-again fill contract:** [`PART-B-FILL.md`](./PART-B-FILL.md) · **Clicks:** [`CLICK.md`](./CLICK.md).

```bash
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
# read session.phase / nextSteps — do not invent a path around a blocked bank
```

Then: generate `answer.md` (best-correct + `drafts/meaning.json`) → parse/validate → **`answer-gates.py --run-aicheck`** (Meaning∧Quality∧Detect; never aicheck alone) → re-run `prepare-answer` until `phase: autofill-ready` → **read PART-B-FILL** → timed autofill → recheck → operator **Submit** yes only.

## Evidence / debt (2026-11-07 / 11-08 host 34123)

| Role | `captureStatus` | Debt |
|------|-----------------|------|
| Software Engineer | `nearly-full` | Q5 **pseudocode**; Verify URL fixed; languages fixed |
| Generalist | `nearly-full` | Instructions expanded; Q1 `$246.64`; Q6 verbatim; plain MD structure 2026-11-08 |
| Data Scientist | verified | 2026-11-10 operator — Q4 digit spot-check matched; Section 3 / meaningful live; 99588+34123 bank |
| (+101 others) | incomplete / stub | full verbatim Bio1+Bio2+assessment |

- Click stack fixed 2026-11-07: zone-safe `locate-click.py` (sidebar/content split, vertical radio columns, Next footer pick, role refuses col-0 default). See [`CLICK.md`](./CLICK.md).
- **Scroll bug fixed 2026-11-08:** sticky Next can show while **Explanation** is below the fold (SE Q1/Q2). Gate with `locate-click.py <look> scroll-complete`; focus content + **PageDown** until ok; save `qN.png` + `qN_bottom.png`.
- **Fetch never-again (99588 DS 2026-11-08):** Source-OCR dumps, select-for-OCR, stuck host OCR, vision-as-verbatim, half-hidden charts → gates in `validate-verbatim.js` + `validate-figures.js` + [`FETCH-GOTCHAS.md`](./FETCH-GOTCHAS.md).
- **Part B feel-test 99588 / Daniel Herman (2026-11-08):** pick PDF/binary + `ui`/`Chemist⊂biochemistry` fixed; role gray-title+segment fix; `answer-ready.js` gate.
- **Part B live fill never-again (99588 night):** scroll-on-space without focus; Expires false marks; SM marks→sidebar; `aim:false` still snaps; Ctrl+C/V ban on DA; Tab+prove-focus; Failure-Yes extras (round/desc/screenshot); TIMER must; relay humanize only → [`PART-B-FILL.md`](./PART-B-FILL.md).
- **Claude setup never-again (99588):** never Continue with Google as leftover account; Claude = same DA email/name (+ password ask or operator self-login) → [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md).
