---
name: DA assessment preflight (before real machine)
when: before connect / before Start assessment / before Part B autofill — deep checklist from 99588 Daniel Herman feel-test
tags: dataannotation, preflight, checklist, answers, fetch
run: node skills/take-dataannotation-assessment/prepare-answer.js --profile "path/to/profile" --strict-full
---
# Preflight — before resume on a real machine

Do this **offline** (or with look-only) before acting on a live one-attempt assessment.

## A. Profile → role → bank

```bash
node skills/dataannotation-assessment-workflow/pick-assessment.js --resume "{profile}/Resume.pdf"
# → pick.slug, pick.role, pick.bank

node skills/take-dataannotation-assessment/prepare-answer.js \
  --profile "{profile}" \
  --strict-full
# → {profile}/session.json  (phase + nextSteps)
```

| Check | Pass when |
|-------|-----------|
| Pick uses PDF extract | `extracted: true`, not Designer-from-binary |
| Slug matches opened card | session.slug === on-screen role |
| Bank ready | `answer-ready` ok under `--strict-full` (`captureStatus: full`) **and** `validate-verbatim.js` + `validate-figures.js` exit 0 |
| Verbatim clean | No summaries / `[bracket]` repairs / `Source OCR` dumps / “pending re-catch” in Prompt bodies (2026-11-08 DS miss) |
| Figures complete | Charts show title + both axes; no half-hidden crops (`validate-figures.js`) |
| Fetch gotchas read | [`FETCH-GOTCHAS.md`](./FETCH-GOTCHAS.md) before Part A on a live host |
| Wrong bank | **stop** — Part A fetch that slug first |

## B. Part A vs Part B decision

| Screen / bank | Do |
|---------------|----|
| Browse roles, bank incomplete | **Part A fetch** only — never Start for “answers” |
| Bio-2 Start, bank incomplete | Fetch mode: Start → copy → **never Submit** → leave |
| Assessment open, bank nearly-full/full, answer.md missing | Generate answers **offline** first |
| Assessment open + playbook ready | Part B autofill with pace |
| Assessment open for **wrong role** vs pick | Chat operator — do not fill the wrong assessment |

## C. Answer artifacts (offline)

1. `{profile}/answer.md` from bank + **this** resume only (`answers.template.md`)
2. `humanize-text.py` / verb `humanize` → relay `POST /api/humanize` with `x-sm-join-key` = `SM_JOIN_KEY` (never `HUMANIZE_API_KEY`)
3. `parse-answer-fill.js` → `answer.fill.json`
4. `validate-answers.js --slug … --answer …` exit 0
5. `prepare-answer.js` again → `answer.pace.json` + `answer.playbook.json`

## D. Machine session rules (HARD)

1. **Listen loop (HARD)** — while the visit is live, end every work burst with `chat_wait {timeout:45000}` and **re-call in the same turn** on `timedOut` / `listening` / `busy:chat-wait` / MCP `-32001`. Do **not** use one giant wait (Cursor aborts long MCP tools). **Never end the Cursor turn** waiting for the operator: ScreenMirror delivers fine; Cursor does not auto-wake on session inbox (live miss: 3× “Start fetch” unread for minutes).
2. Every act: `look` → measure on that PNG → act. Prefer `locate-click.py`. For **Browse role cards** on OCR-blind hosts: `look-ocr.js --find "Role Title"` → dbl body (`ly+55`).
3. **Never** host `clickText`/`find` when `saw` is only browser chrome.
4. **Never** `keys human:0`.
5. Radios: `radios` (choice cluster) then `radio N` — not raw 13-hit columns.
6. Browse cards: `role "Title"` → **`dbl`**. Filter/search if col-2 weak.
7. One action → look prove → next. No blind batches.
8. **Never Submit** until operator says `Submit` / yes after recheck.
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
12h. **Read [`PART-B-FILL.md`](./PART-B-FILL.md)** before first live Part B `keys` this session.
13. **Part B humanize:** relay `POST /api/humanize` (`x-sm-join-key` = `SM_JOIN_KEY`) or verb `{"do":"humanize",…}`. Optional `aicheck` / `aiusage`. **Never** `HUMANIZE_API_KEY` / Bearer / wisdom324.
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

**Canonical never-again doc:** [`PART-B-FILL.md`](./PART-B-FILL.md).

State after night try: Step 2 mostly filled (Goal, attach No, failure Yes, round 1, describe, Poor, rationale). Claude free account created; desktop Skip / share URL / screenshot / Section 2 still open. **No Submit.**
