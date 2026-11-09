---
name: DA assessment preflight (before real machine)
when: before connect / before Start assessment / before Part B autofill — deep checklist from 99588 Daniel Herman feel-test
tags: dataannotation, preflight, checklist, answers, fetch
run: node skills/take-dataannotation-assessment/prepare-answer.js --profile "path/to/profile" --strict-full
---
# Preflight — before resume on a real machine

## MUST — Never Submit until operator yes

**Always.** No fetch, fill, recheck, or sign-off may click Submit unless the operator explicitly says **yes** / **Submit**. Not optional.

## MUST — Full name + email first

Before connect / prepare / fetch / fill, the operator must give:

1. **Full name** (First + Last) — DA / Claude identity  
2. **Email** — same as DataAnnotation account for this worker  

If either is missing → `chat` ask once → `chat_wait` → do not continue. Never invent. Password: ask only when a login page needs it (operator types or sends secret).

Do this **offline** (or with look-only) before acting on a live one-attempt assessment.

## A. Profile → role → bank

**HARD — always auto-pick role from resume** until the operator says they will pick manually (e.g. “I will pick assessment manually” / “I’ll pick” + a role). Do **not** ask which assessment. `prepare-answer.js --profile` (no `--slug`) runs `pick-assessment.js` and sets `session.slug` / `session.role`.

```bash
node skills/take-dataannotation-assessment/prepare-answer.js \
  --profile "{profile}" \
  --strict-full
# → pick from Resume → {profile}/session.json (slug, role, phase, nextSteps)
# Manual override only after operator says they will pick: --slug {slug}
```

| Check | Pass when |
|-------|-----------|
| Pick uses PDF extract | `session.pick.extracted: true` (or pick stdout), not Designer-from-binary |
| Opened card matches pick | on-screen role === `session.role` / `session.slug` |
| Bank ready | `answer-ready` ok under `--strict-full` (`captureStatus: full`) **and** `validate-verbatim.js` + `validate-figures.js` exit 0 |
| Verbatim clean | No summaries / `[bracket]` repairs / `Source OCR` dumps / “pending re-catch” in Prompt bodies (2026-11-08 DS miss) |
| Figures complete | Charts show title + both axes; no half-hidden crops (`validate-figures.js`) |
| Fetch gotchas read | [`FETCH-GOTCHAS.md`](./FETCH-GOTCHAS.md) before Part A on a live host |
| Wrong / missing bank | **complete Part A fetch for session.slug first** (automatic — do not skip) |

## B. Part A vs Part B decision

**HARD — complete the bank first.** If `problems-{slug}.md` is missing or `captureStatus` is not `full`/`verified`, fetch/complete that bank **before** writing `answer.md` or live fill. Do not ask the operator; this is the default path.

| Screen / bank | Do |
|---------------|----|
| Bank missing / incomplete | **Part A fetch** that auto-picked slug first (verbatim, never Submit) until `full`/`verified` |
| Browse roles, bank incomplete | Part A fetch only — never Start for “answers” |
| Bio-2 Start, bank incomplete | Fetch mode: Start → copy → **never Submit** → leave |
| Bank ready, answer.md missing | Generate answers **offline** first |
| Assessment open + playbook ready | Part B autofill with pace |
| Assessment open for **wrong role** vs `session.role` | Stop — open the auto-picked card; do not fill the wrong assessment |

## C. Answer artifacts (offline)

1. `{profile}/answer.md` from bank + **this** resume only (`answers.template.md` **agent-v2**: Fields + Values fences; `near` on empty boxes)
2. `humanize-text.py` / verb `humanize` → relay `POST /api/humanize` with `x-sm-join-key` = `SM_JOIN_KEY` (never `HUMANIZE_API_KEY`)
3. `parse-answer-fill.js` → `answer.fill.json` (Values fences win; `claude[]` separate from DA actions)
4. `validate-answers.js --slug … --answer …` exit 0
5. **Best answer (HARD):** [`ANSWER-GATES.md`](./ANSWER-GATES.md) — meaning card → best correct → MeaningPass → QualityPass → voice → MQ again → DetectPass. **Required:** `answer-gates.py --profile … --run-aicheck` exit **0** before autofill. **Illegal:** keep ai≤20 if Meaning/Quality fail; done on aicheck alone.
6. `prepare-answer.js` again → pace + playbook. **Must** emit `phase: autofill-ready` (re-runs gates; `gates-pending` / exit 1 = do not fill).

## D. Machine session rules (HARD)

1. **Listen loop (HARD)** — while the visit is live, end every work burst with `chat_wait {timeout:45000}` and **re-call in the same turn** on `timedOut` / `listening` / `busy:chat-wait` / MCP `-32001`. Do **not** use one giant wait (Cursor aborts long MCP tools). **Never end the Cursor turn** waiting for the operator: ScreenMirror delivers fine; Cursor does not auto-wake on session inbox (live miss: 3× “Start fetch” unread for minutes).
2. Every act: `look` → measure on that PNG → act. Prefer `locate-click.py`. For **Browse role cards** on OCR-blind hosts: `look-ocr.js --find "Role Title"` → dbl body (`ly+55`).
3. **Never** host `clickText`/`find` when `saw` is only browser chrome.
4. **Never** `keys human:0`.
5. Radios: `radios` (choice cluster) then `radio N` — not raw 13-hit columns.
6. Browse cards: `role "Title"` → **`dbl`**. Filter/search if col-2 weak.
7. One action → look prove → next. No blind batches.
8. **MUST — Never Submit** until operator explicit `Submit` / `yes` after recheck (silence ≠ yes).
9. If `busy: chat-wait` — wait for that flight or reconnect; do not hammer parallel tools.
10. **Part A OCR:** never select/highlight for OCR; if host `ocr` repeats Instructions after scroll → look band-OCR. Never bank vision/`image_description` as problem text. Pass `host` on every serve call when ≥2 visits are open.
11. **Part A figures:** crop only when the full figure (axes included) is in-frame; run `validate-figures.js` before `full`.
12. **Part B clear fields:** Backspace only — never Ctrl+A (live miss 99588: selects whole page).
12b. **Part B textareas:** `locate-click.py textarea` (taller first) — never SM blank `field ""` marks (Expires). Prefer content→Tab when click focus fails. **Prove focus** with one non-space letter → look before full `keys` (spaces on body = scroll bug).
12c. **Part B on DA pages:** never Ctrl+C / Ctrl+V (operator hard rule 99588). Type with `keys` only. Clipboard Ctrl+L/C only for outside-link fetch tabs, never while tasking the assessment.
12d. **Small targets (checkboxes):** `look-ocr` label → click left of bbox; always `snap:false` + `aim:false`; prove with look. `aim:false` alone still snaps.
12e. **SM content marks:** Yes/No/Poor/`1` marks often click **x≈80** — use locate-click content lx or Tab; never trust those marks.
12f. **Host lock:** only the operator-named host; pass `host` on every call. Prefer live UI model name over bank.
12g. **Failure Yes extras:** round + describe + screenshot may appear — fill them; patch bank if missing. Share URL = real Claude chat then `keys` (never paste on DA).
12h. **Read [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) + [`PART-B-FILL.md`](./PART-B-FILL.md)** before first live Part B `keys` this session.
12i. **Claude setup:** [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md) — same DA email/name (+ password ask); **never** Continue with Google as a non-DA leftover account (99588 miss: geroge).
12j. **Typer:** only SM `keys` — **never** `xdotool type` / machine type (99588: produced `xsleep…` garbage).
12k. **Empty rubrics/Goal:** OCR white-box click (`y≈placeholder+35`, `snap:false aim:false`) — placeholder mark alone fails prove.
12l. **One recheck** after last field — do not full-page verify after every textarea.
12m. **Fill = tape replay** of `answer.md` Fields — answers prepared offline; live time is focus+type only (budget ≤25–35 min post-share).
13. **Part B gates (HARD):** follow [`ANSWER-GATES.md`](./ANSWER-GATES.md). Remake/autofill only after `answer-gates.py --profile … --run-aicheck` exit **0**. **Never** `HUMANIZE_API_KEY` / Bearer / wisdom324.
14. **Toolbar Scroll to Bottom:** can jump to Submit footer — prefer sidebar leaf / content PageDown. Prove wheel direction with a look; prefer PageDown after content focus.

## E. Autofill loop (from playbook)

**0. TIMER MUST** — right after **Start assessment**, before Instructions: arm ScreenMirror `status`/`mission` tree (`playbook.timer`) and create `{profile}/answer.timer.json`. See [`TIMER.md`](./TIMER.md).

For each `answer.playbook.json` action in order:

1. If `firstInStep`: `status { step: "Step k · leaf" }` + log `step_start` (panel stopwatch).
2. If sidebar available → `sidebar` jump to step (prefer over sticky Next).
3. `pause { ms: pauseMs }`.
4. Run `recipe[]` (radio / type / drag / agree).
5. Look prove; on miss → re-measure once; second miss → replan / ask.
6. If leaf complete: flip tree leaf `done` + log `step_done` with timestamps.
7. After last required → sidebar walk recheck → chat review.

## F. Stop conditions

- Budget spent → `budget {more:1}` ask
- CAPTCHA → `captcha` (person only)
- Wrong role assessment already started → ask operator; do not invent DS answers into SE form
- `answer-ready` fails mid-flight → stop fill; fetch/fix bank
- `session.phase === gates-pending` or `answer.gates.json` not ok → **stop**; fix Values + re-run gates (never fill on Detect alone)

## Evidence source

99588 / Daniel Herman 2026-11-08 feel-test: pick PDF bug, role gray-title, SE wrong open, radio 13-hit noise, chat-wait stick, DS bank incomplete vs SE nearly-full.

### Part B live try 99588 Daniel Herman / Data Scientist (2026-11-08)

| Bug | Fix / rule |
|-----|------------|
| Wrong host (34123 vs 99588) | Only operator-named host; `host` on every call |
| `Ctrl+A` selects whole assessment page | **Backspace only** |
| Ctrl+C / Ctrl+V on assessment | **Forbidden** — `keys` only on DA pages |
| Auto-type scrolls (spaces on document) | Prove focus: one non-space char → look → then type |
| Empty Goal mark = Expires | `locate-click.py textarea`; never SM `field ""` |
| SM Yes/No/Poor marks → x≈80 | Content lx or Tab; marks lie |
| Direct textarea click no focus | Content label → Tab; taller `#f8` first |
| `aim:false` still snaps checkbox | Always `snap:false` + OCR-left-of-label Y |
| Toolbar Scroll to Bottom → Submit | Sidebar / content PageDown |
| Bio1 Continue stale coords | Re-measure / mark Continue on current look |
| wisdom324 / `HUMANIZE_API_KEY` Bearer | Relay join-key / verb `humanize` only |
| Bank Haiku 5.5 vs live 3.5 | Prefer **live UI** |
| Failure Yes reveals round/desc/screenshot | Fill + patch bank; share needs real Claude |
| Share URL paste | Real chat → type URL with `keys` (no Ctrl+V on DA) |
| No timer after Start | **MUST** arm [`TIMER.md`](./TIMER.md) immediately |
| Playbook pauseMs ~10 min/field | Shorter for feel-test unless operator wants full pace |
| Long keys MCP 35s abort | Wait for late answer; do not double-type |
| Wheel `n` direction wrong | Prove with look; prefer PageDown |
| Claude Round 1 bare `\n` / bad Shift+Enter | Kate→Ctrl+V; `chord ShiftLeft+Enter`; blank line before Setup |
| Placeholder rubric mark no focus | OCR white-box click + letter prove |
| `xdotool type` / exec sleep typers | **Banned** — SM `keys` only; caused `xsleep…` corruption |
| Expires chip stale `same≈0.83` | Fresh look → mark ASAP or snap:false screen xy |
| Full verify after every field | **One** recheck before Submit ask |
| Explore UI vs Fields tape | Follow [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md); fill budget ≤25–35 min |
| Detect-only remake kept weak humanize | Meaning∧Quality∧Detect via [`ANSWER-GATES.md`](./ANSWER-GATES.md); prepare refuses autofill |
| q2b fused order into coeffs / q4 praised A | QualityPass On form criteria |
| Colon scrub broke share `https://` | URL-lock in `humanize-text.py` scrub |
| False must_not on “locked labeling” | Bare phrases get word boundaries in `meaning-gate.py` |

**Canonical runbook:** [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) · **Field contract:** [`PART-B-FILL.md`](./PART-B-FILL.md) · **Answer gates:** [`ANSWER-GATES.md`](./ANSWER-GATES.md).

State after full night try (2026-11-08/09): Section 1 (incl. share URL) + Q1–Q4 + both Q3a rubrics + S3 education/project filled; rationale cleaned of `xsleep` garbage; **not Submitted**; visit signed off for study.
