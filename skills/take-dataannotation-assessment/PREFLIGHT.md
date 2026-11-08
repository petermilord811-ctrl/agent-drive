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
| Bank ready | `answer-ready` ok under `--strict-full` (`captureStatus: full`) |
| Wrong bank | **stop** — Part A fetch that slug first (Daniel → `data-scientist` was incomplete) |

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
2. `humanize-text.py --json-in … --json-out …` (balanced)
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

## E. Autofill loop (from playbook)

For each `answer.playbook.json` action in order:

1. If `firstInStep` and sidebar available → `sidebar` jump to step (prefer over sticky Next).
2. `pause { ms: pauseMs }`.
3. Run `recipe[]` (radio / type / drag / agree).
4. Look prove; on miss → re-measure once; second miss → replan / ask.
5. After last required → sidebar walk recheck → chat review.

## F. Stop conditions

- Budget spent → `budget {more:1}` ask
- CAPTCHA → `captcha` (person only)
- Wrong role assessment already started → ask operator; do not invent DS answers into SE form
- `answer-ready` fails mid-flight → stop fill; fetch/fix bank

## Evidence source

99588 / Daniel Herman 2026-11-08 feel-test: pick PDF bug, role gray-title, SE wrong open, radio 13-hit noise, chat-wait stick, DS bank incomplete vs SE nearly-full.
